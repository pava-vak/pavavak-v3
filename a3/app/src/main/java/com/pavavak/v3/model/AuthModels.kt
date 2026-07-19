package com.pavavak.v3.model

data class DevLoginRequest(val userId: Int, val username: String, val displayName: String, val isAdmin: Boolean)
data class LoginRequest(val username: String, val password: String)
data class RegisterRequest(val username: String, val displayName: String, val password: String)
data class RefreshRequest(val refreshToken: String)
data class TokenBundle(val accessToken: String, val refreshToken: String, val tokenType: String)
data class V3User(val userId: Int, val username: String, val displayName: String, val isAdmin: Boolean)
data class DevLoginResponse(val success: Boolean, val tokens: TokenBundle, val user: V3User)
data class AuthResponse(val success: Boolean, val tokens: TokenBundle, val user: V3User)
data class MeResponse(val success: Boolean, val user: V3User)
data class RefreshResponse(val success: Boolean, val tokens: TokenBundle, val user: V3User? = null)
