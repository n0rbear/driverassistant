package com.example.driverassistant.data.api

import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

data class OsrmResponse(
    val routes: List<OsrmRoute>
)

data class OsrmRoute(
    val distance: Double, // meters
    val duration: Double // seconds
)

interface OsrmApi {
    @GET("route/v1/driving/{coords}")
    suspend fun getRoute(
        @Path("coords") coords: String,
        @Query("overview") overview: String = "false"
    ): OsrmResponse
}
