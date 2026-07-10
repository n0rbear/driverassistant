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
class TagesfahrblattViewModel @Inject constructor(
    private val repository: DriverRepository,
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: android.content.Context
) : ViewModel() {

    private val prefs = context.getSharedPreferences("driver_prefs", android.content.Context.MODE_PRIVATE)
    
    private val _driverName = MutableStateFlow(prefs.getString("driver_name", "Ismeretlen Sofőr") ?: "Ismeretlen Sofőr")
    val driverNameFlow = _driverName.asStateFlow()

    private val dateSdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
    
    private val _selectedDate = MutableStateFlow(dateSdf.format(Date()))
    val selectedDate = _selectedDate.asStateFlow()

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val dayData = combine(driverNameFlow, _selectedDate) { name, date ->
        name to date
    }.flatMapLatest { (name, date) ->
        repository.getWorkTimesByDate(date, name)
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

    fun setDate(date: Long) {
        _selectedDate.value = dateSdf.format(Date(date))
    }

    fun getTimelineItems(): List<TimelineItem> {
        val sorted = dayData.value.sortedBy { it.startTime }
        return sorted.map { wt ->
            val start = formatTime(wt.startTime)
            val end = wt.endTime?.let { formatTime(it) } ?: "..."
            TimelineItem(
                type = wt.type,
                interval = "$start - $end",
                notes = wt.notes,
                mileage = wt.mileage,
                endMileage = wt.endMileage,
                plate = wt.licensePlate
            )
        }
    }

    private fun formatTime(time: Long): String {
        return SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(time))
    }
}

data class TimelineItem(
    val type: String,
    val interval: String,
    val notes: String,
    val mileage: Int? = null,
    val endMileage: Int? = null,
    val plate: String? = null
)
