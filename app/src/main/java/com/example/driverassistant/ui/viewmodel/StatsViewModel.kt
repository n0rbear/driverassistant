package com.example.driverassistant.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.driverassistant.domain.model.WorkTime
import com.example.driverassistant.domain.repository.DriverRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*
import javax.inject.Inject

@HiltViewModel
class StatsViewModel @Inject constructor(
    private val repository: DriverRepository,
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: android.content.Context
) : ViewModel() {

    private val prefs = context.getSharedPreferences("driver_prefs", android.content.Context.MODE_PRIVATE)
    
    private val _driverName = MutableStateFlow(prefs.getString("driver_name", "Ismeretlen Sofőr") ?: "Ismeretlen Sofőr")
    val driverNameFlow = _driverName.asStateFlow()

    private val monthSdf = SimpleDateFormat("yyyy-MM", Locale.getDefault())
    private val _selectedMonth = MutableStateFlow(monthSdf.format(Date()))
    val selectedMonth = _selectedMonth.asStateFlow()

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val monthlyWorkTimes = combine(driverNameFlow, _selectedMonth) { name, month ->
        name to month
    }.flatMapLatest { (name, month) ->
        repository.getWorkTimesByPattern("$month%", name)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    init {
        viewModelScope.launch {
            while(true) {
                val latest = prefs.getString("driver_name", "Ismeretlen Sofőr") ?: "Ismeretlen Sofőr"
                if (latest != _driverName.value) _driverName.value = latest
                kotlinx.coroutines.delay(2000)
            }
        }
    }

    fun getMonthlySummary(): MonthlySummary {
        val times = monthlyWorkTimes.value.filter { it.date.startsWith(_selectedMonth.value) }
        val totalWorkMs = times.filter { it.type != "Pihenő" }.sumOf { (it.endTime ?: System.currentTimeMillis()) - it.startTime }
        val driveMs = times.filter { it.type == "Vezetés" }.sumOf { (it.endTime ?: System.currentTimeMillis()) - it.startTime }
        
        val workDays = times.map { it.date }.distinct().size
        val expectedMs = workDays * 8L * 3600000L // 8 órás munkanapok
        
        return MonthlySummary(
            totalWorkHours = totalWorkMs / 3600000.0,
            driveHours = driveMs / 3600000.0,
            zeitkontoBalance = (totalWorkMs - expectedMs) / 3600000.0,
            workDays = workDays
        )
    }
}

data class MonthlySummary(
    val totalWorkHours: Double,
    val driveHours: Double,
    val zeitkontoBalance: Double,
    val workDays: Int
)
