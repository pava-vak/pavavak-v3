package com.pavavak.v3.api

import android.content.Context
import com.pavavak.v3.BuildConfig
import com.pavavak.v3.model.RefreshRequest
import com.pavavak.v3.realtime.SocketTokenNotifier
import com.pavavak.v3.util.SessionExpiredNotifier
import com.pavavak.v3.util.SessionStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import okhttp3.Authenticator
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.Route
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.atomic.AtomicReference

object V3Api {
    private val refreshWaiter = AtomicReference<CompletableDeferred<String?>?>(null)

    @Volatile
    private var service: V3Service? = null

    fun create(context: Context): V3Service {
        service?.let { return it }
        synchronized(this) {
            if (service != null) return service!!
            val sessionStore = SessionStore(context.applicationContext)
            service = buildRetrofit(sessionStore, BuildConfig.DEBUG).create(V3Service::class.java)
            return service!!
        }
    }

    fun invalidate() {
        synchronized(this) {
            service = null
        }
    }

    suspend fun refreshForRealtime(context: Context): Boolean {
        val sessionStore = SessionStore(context.applicationContext)
        val refreshToken = sessionStore.refreshToken()
        if (refreshToken.isBlank()) {
            sessionStore.clear()
            SessionExpiredNotifier.notifySessionExpired()
            return false
        }

        return withContext(Dispatchers.IO) {
            runCatching {
                val refreshService = buildRetrofit(sessionStore, logging = false).create(V3Service::class.java)
                val response = refreshService.refreshBlocking(RefreshRequest(refreshToken)).execute()
                val body = response.body()
                if (!response.isSuccessful || body == null) {
                    sessionStore.clear()
                    invalidate()
                    SessionExpiredNotifier.notifySessionExpired()
                    false
                } else {
                    sessionStore.saveTokens(body.tokens.accessToken, body.tokens.refreshToken)
                    SocketTokenNotifier.notifyTokenRefreshed()
                    true
                }
            }.getOrElse {
                sessionStore.clear()
                invalidate()
                SessionExpiredNotifier.notifySessionExpired()
                false
            }
        }
    }

    private fun buildRetrofit(sessionStore: SessionStore, logging: Boolean): Retrofit {
        val authInterceptor = Interceptor { chain ->
            val requestBuilder = chain.request().newBuilder()
            val accessToken = sessionStore.accessToken()
            if (accessToken.isNotBlank()) {
                requestBuilder.addHeader("Authorization", "Bearer $accessToken")
            }
            chain.proceed(requestBuilder.build())
        }

        val authenticator = Authenticator { _: Route?, response: Response ->
            if (response.code != 401) return@Authenticator null

            val existing = refreshWaiter.get()
            if (existing != null) {
                val token = runBlocking { existing.await() }
                return@Authenticator token?.let {
                    response.request.newBuilder().header("Authorization", "Bearer $it").build()
                }
            }

            val waiter = CompletableDeferred<String?>()
            refreshWaiter.set(waiter)
            try {
                val refreshToken = sessionStore.refreshToken()
                if (refreshToken.isBlank()) {
                    sessionStore.clear()
                    SessionExpiredNotifier.notifySessionExpired()
                    waiter.complete(null)
                    return@Authenticator null
                }

                val refreshService = buildRetrofit(sessionStore, logging = false).create(V3Service::class.java)
                val refreshResponse = refreshService.refreshBlocking(RefreshRequest(refreshToken)).execute()
                if (!refreshResponse.isSuccessful) {
                    sessionStore.clear()
                    V3Api.invalidate()
                    SessionExpiredNotifier.notifySessionExpired()
                    waiter.complete(null)
                    return@Authenticator null
                }

                val body = refreshResponse.body() ?: run {
                    waiter.complete(null)
                    return@Authenticator null
                }
                sessionStore.saveTokens(body.tokens.accessToken, body.tokens.refreshToken)
                SocketTokenNotifier.notifyTokenRefreshed()
                waiter.complete(body.tokens.accessToken)
                response.request.newBuilder()
                    .header("Authorization", "Bearer ${body.tokens.accessToken}")
                    .build()
            } catch (_: Exception) {
                sessionStore.clear()
                V3Api.invalidate()
                SessionExpiredNotifier.notifySessionExpired()
                waiter.complete(null)
                null
            } finally {
                refreshWaiter.set(null)
            }
        }

        val builder = OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .authenticator(authenticator)

        if (logging) {
            builder.addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
        }

        return Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(builder.build())
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }
}
