package com.pavavak.v3.api

import com.pavavak.v3.model.ChatListResponse
import com.pavavak.v3.model.DevLoginRequest
import com.pavavak.v3.model.DevLoginResponse
import com.pavavak.v3.model.DirectChatRequest
import com.pavavak.v3.model.DirectChatResponse
import com.pavavak.v3.model.AuthResponse
import com.pavavak.v3.model.LoginRequest
import com.pavavak.v3.model.MeResponse
import com.pavavak.v3.model.ReadChatResponse
import com.pavavak.v3.model.ReceiptRequest
import com.pavavak.v3.model.ReceiptResponse
import com.pavavak.v3.model.RefreshRequest
import com.pavavak.v3.model.RefreshResponse
import com.pavavak.v3.model.RegisterRequest
import com.pavavak.v3.model.SendMessageRequest
import com.pavavak.v3.model.SendMessageResponse
import com.pavavak.v3.model.ThreadResponse
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface V3Service {
    @POST("api/v3/auth/dev-login")
    suspend fun devLogin(@Body request: DevLoginRequest): DevLoginResponse

    @POST("api/v3/auth/login")
    suspend fun login(@Body request: LoginRequest): AuthResponse

    @POST("api/v3/auth/register")
    suspend fun register(@Body request: RegisterRequest): AuthResponse

    @POST("api/v3/auth/refresh")
    suspend fun refresh(@Body request: RefreshRequest): RefreshResponse

    @POST("api/v3/auth/refresh")
    fun refreshBlocking(@Body request: RefreshRequest): retrofit2.Call<RefreshResponse>

    @GET("api/v3/me")
    suspend fun me(): MeResponse

    @GET("api/v3/chats")
    suspend fun chats(): ChatListResponse

    @GET("api/v3/chats/{chatId}/messages")
    suspend fun thread(@Path("chatId") chatId: String): ThreadResponse

    @POST("api/v3/messages")
    suspend fun send(@Body request: SendMessageRequest): SendMessageResponse

    @POST("api/v3/chats/direct")
    suspend fun startDirectChat(@Body request: DirectChatRequest): DirectChatResponse

    @POST("api/v3/chats/{chatId}/read")
    suspend fun markChatRead(@Path("chatId") chatId: String): ReadChatResponse

    @POST("api/v3/messages/{messageId}/delivered")
    suspend fun markDelivered(@Path("messageId") messageId: String, @Body request: ReceiptRequest): ReceiptResponse

    @POST("api/v3/messages/{messageId}/read")
    suspend fun markRead(@Path("messageId") messageId: String, @Body request: ReceiptRequest): ReceiptResponse
}
