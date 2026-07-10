package com.example.driverassistant.ui.components

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun AILoadingAnimation() {
    val infiniteTransition = rememberInfiniteTransition(label = "loading")
    
    val scale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1.5f,
        animationSpec = infiniteRepeatable(
            animation = tween(1000, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "scale"
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.6f)),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                LoadingDot(infiniteTransition, 0)
                LoadingDot(infiniteTransition, 300)
                LoadingDot(infiniteTransition, 600)
            }
            
            Spacer(modifier = Modifier.height(24.dp))
            
            Text(
                text = "AI elemzés folyamatban...",
                color = Color.White,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.scale(scale)
            )
        }
    }
}

@Composable
private fun LoadingDot(transition: InfiniteTransition, delayMillis: Int) {
    val scale by transition.animateFloat(
        initialValue = 0.5f,
        targetValue = 1.2f,
        animationSpec = infiniteRepeatable(
            animation = tween(600, delayMillis = delayMillis, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "dotScale"
    )

    Box(
        modifier = Modifier
            .size(16.dp)
            .scale(scale)
            .background(MaterialTheme.colorScheme.primary, CircleShape)
    )
}
