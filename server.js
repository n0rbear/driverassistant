package com.example.driverassistant.di

import android.content.Context
import androidx.room.Room
import com.example.driverassistant.data.api.BackendApi
import com.example.driverassistant.data.local.DriverDatabase
import com.example.driverassistant.data.local.dao.DriverDao
import com.example.driverassistant.data.repository.DriverRepositoryImpl
import com.example.driverassistant.data.repository.LocationRepositoryImpl
import com.example.driverassistant.domain.repository.DriverRepository
import com.example.driverassistant.domain.repository.LocationRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): DriverDatabase {
        return Room.databaseBuilder(
            context,
            DriverDatabase::class.java,
            "driver_assistant_db"
        )
            .addMigrations(
                DriverDatabase.MIGRATION_13_14,
                DriverDatabase.MIGRATION_14_15,
                DriverDatabase.MIGRATION_15_16,
                DriverDatabase.MIGRATION_16_17,
                DriverDatabase.MIGRATION_17_18,
                DriverDatabase.MIGRATION_18_19
            )
            .build()
    }

    @Provides
    @Singleton
    fun provideDao(db: DriverDatabase): DriverDao {
        return db.dao
    }

    @Provides
    @Singleton
    fun provideRepository(dao: DriverDao, backendApi: BackendApi): DriverRepository {
        return DriverRepositoryImpl(dao, backendApi)
    }

    @Provides
    @Singleton
    fun provideLocationRepository(dao: DriverDao): LocationRepository {
        return LocationRepositoryImpl(dao)
    }
}
