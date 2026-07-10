package com.example.driverassistant.di

import com.example.driverassistant.data.api.BackendApi
import com.example.driverassistant.data.api.MistralApi
import com.example.driverassistant.data.api.OsrmApi
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import javax.inject.Singleton
import java.util.concurrent.TimeUnit

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    fun provideOkHttpClient(): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }
        return OkHttpClient.Builder()
            .addInterceptor(logging)
            .connectTimeout(60, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
    }

    @Provides
    @Singleton
    fun provideMistralApi(client: OkHttpClient): MistralApi {
        return Retrofit.Builder()
            .baseUrl("https://api.mistral.ai/")
            .addConverterFactory(GsonConverterFactory.create())
            .client(client)
            .build()
            .create(MistralApi::class.java)
    }

    @Provides
    @Singleton
    fun provideBackendApi(client: OkHttpClient): BackendApi {
        return Retrofit.Builder()
            .baseUrl("https://driverassistant.onrender.com/") // ÍRD ÁT A SAJÁT CÍMEDRE!
            .addConverterFactory(GsonConverterFactory.create())
            .client(client)
            .build()
            .create(BackendApi::class.java)
    }

    @Provides
    @Singleton
    fun provideOsrmApi(client: OkHttpClient): OsrmApi {
        return Retrofit.Builder()
            .baseUrl("https://router.project-osrm.org/")
            .addConverterFactory(GsonConverterFactory.create())
            .client(client)
            .build()
            .create(OsrmApi::class.java)
    }
}
