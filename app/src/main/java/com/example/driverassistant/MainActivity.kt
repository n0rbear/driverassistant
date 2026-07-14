package com.example.driverassistant

import android.Manifest
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.example.driverassistant.ui.navigation.Screen
import com.example.driverassistant.ui.navigation.bottomNavItems
import com.example.driverassistant.ui.screen.*
import com.example.driverassistant.ui.theme.DriverAssistantTheme
import com.example.driverassistant.ui.viewmodel.ProfileViewModel
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            DriverAssistantTheme {
                RequestPermissions()
                
                var showNameDialog by remember { 
                    val prefs = getSharedPreferences("driver_prefs", Context.MODE_PRIVATE)
                    mutableStateOf(prefs.getString("driver_name", null) == null) 
                }

                if (showNameDialog) {
                    DriverNameDialog(
                        onNameSaved = { name, phone, email ->
                            val prefs = getSharedPreferences("driver_prefs", Context.MODE_PRIVATE)
                            prefs.edit().apply {
                                putString("driver_name", name)
                                putString("driver_phone", phone)
                                putString("driver_email", email)
                                apply()
                            }
                            showNameDialog = false
                        },
                        onLinked = {
                            showNameDialog = false
                        }
                    )
                } else {
                    LocationServiceManager()
                    MainApp()
                }
            }
        }
    }
}

@Composable
fun LocationServiceManager() {
    val context = androidx.compose.ui.platform.LocalContext.current
    LaunchedEffect(Unit) {
        while (true) {
            val hasFineLocation = androidx.core.content.ContextCompat.checkSelfPermission(
                context,
                android.Manifest.permission.ACCESS_FINE_LOCATION
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED

            val hasCoarseLocation = androidx.core.content.ContextCompat.checkSelfPermission(
                context,
                android.Manifest.permission.ACCESS_COARSE_LOCATION
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED

            if (hasFineLocation || hasCoarseLocation) {
                val intent = Intent(context, com.example.driverassistant.service.LocationService::class.java).apply {
                    action = com.example.driverassistant.service.LocationService.ACTION_START
                }
                context.startForegroundService(intent)
            }
            kotlinx.coroutines.delay(15000)
        }
    }
}

@Composable
fun DriverNameDialog(
    onNameSaved: (String, String, String) -> Unit,
    onLinked: () -> Unit,
    profileViewModel: ProfileViewModel = hiltViewModel()
) {
    val context = LocalContext.current
    var name by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var showLinkDialog by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        profileViewModel.events.collectLatest { message ->
            Toast.makeText(context, message, Toast.LENGTH_LONG).show()
            if (message.startsWith("Telefon társítva")) {
                onLinked()
            }
        }
    }
    
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Surface(
            shape = MaterialTheme.shapes.medium,
            tonalElevation = 4.dp,
            modifier = Modifier.padding(24.dp)
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text(text = "Üdvözlünk!", style = MaterialTheme.typography.headlineMedium)
                Text(text = "Kérjük, add meg az adataidat az indításhoz.")
                
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Teljes név") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )
                
                OutlinedTextField(
                    value = phone,
                    onValueChange = { phone = it },
                    label = { Text("Telefonszám") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("Email cím") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )
                
                Button(
                    onClick = { if (name.isNotBlank()) onNameSaved(name, phone, email) },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = name.isNotBlank()
                ) {
                    Text("Indítás")
                }

                HorizontalDivider()

                OutlinedButton(
                    onClick = { showLinkDialog = true },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Meglévő webes profil társítása")
                }
            }
        }
    }

    if (showLinkDialog) {
        LinkDeviceDialog(
            onDismiss = { showLinkDialog = false },
            onConfirm = { code ->
                profileViewModel.linkWithActivationCode(code)
                showLinkDialog = false
            }
        )
    }
}

@Composable
fun RequestPermissions() {
    val context = LocalContext.current
    val permissionsToRequest = mutableListOf(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION,
        Manifest.permission.CAMERA
    ).apply {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            add(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        val hasLocation = grants[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            grants[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (hasLocation) {
            val intent = Intent(context, com.example.driverassistant.service.LocationService::class.java).apply {
                action = com.example.driverassistant.service.LocationService.ACTION_START
            }
            context.startForegroundService(intent)
        }
    }

    LaunchedEffect(Unit) {
        launcher.launch(permissionsToRequest.toTypedArray())
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainApp() {
    val navController = rememberNavController()
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route
    val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)
    val scope = rememberCoroutineScope()

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet {
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    if (BuildConfig.IS_TEST_APP) "LOGIHERO Driver Assistant" else "Driver Assistant",
                    modifier = Modifier.padding(16.dp),
                    style = MaterialTheme.typography.headlineSmall
                )
                HorizontalDivider()
                com.example.driverassistant.ui.navigation.drawerItems.forEach { screen ->
                    NavigationDrawerItem(
                        icon = { Icon(screen.icon, contentDescription = null) },
                        label = { Text(screen.title) },
                        selected = currentRoute == screen.route,
                        onClick = {
                            scope.launch { drawerState.close() }
                            navController.navigate(screen.route) {
                                popUpTo(navController.graph.startDestinationId) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding)
                    )
                }
            }
        }
    ) {
        Scaffold(
            topBar = {
                CenterAlignedTopAppBar(
                    title = {
                        val title = com.example.driverassistant.ui.navigation.drawerItems
                            .find { it.route == currentRoute }?.title ?: "Driver Assistant"
                        Text(if (BuildConfig.IS_TEST_APP) "LOGIHERO · $title" else title)
                    },
                    navigationIcon = {
                        IconButton(onClick = { scope.launch { drawerState.open() } }) {
                            Icon(Icons.Default.Menu, contentDescription = "Menü")
                        }
                    },
                    colors = if (BuildConfig.IS_TEST_APP) {
                        TopAppBarDefaults.centerAlignedTopAppBarColors(
                            containerColor = Color.Black,
                            titleContentColor = MaterialTheme.colorScheme.primary,
                            navigationIconContentColor = MaterialTheme.colorScheme.primary,
                            actionIconContentColor = MaterialTheme.colorScheme.primary
                        )
                    } else {
                        TopAppBarDefaults.centerAlignedTopAppBarColors()
                    }
                )
            },
            bottomBar = {
                NavigationBar(
                    containerColor = if (BuildConfig.IS_TEST_APP) Color.Black else NavigationBarDefaults.containerColor,
                    contentColor = if (BuildConfig.IS_TEST_APP) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface
                ) {
                    bottomNavItems.forEach { screen ->
                        NavigationBarItem(
                            icon = { Icon(screen.icon, contentDescription = screen.title) },
                            label = { Text(screen.title) },
                            selected = currentRoute == screen.route,
                            colors = if (BuildConfig.IS_TEST_APP) {
                                NavigationBarItemDefaults.colors(
                                    selectedIconColor = Color.Black,
                                    selectedTextColor = MaterialTheme.colorScheme.primary,
                                    indicatorColor = MaterialTheme.colorScheme.primary,
                                    unselectedIconColor = Color.White.copy(alpha = 0.72f),
                                    unselectedTextColor = Color.White.copy(alpha = 0.72f)
                                )
                            } else {
                                NavigationBarItemDefaults.colors()
                            },
                            onClick = {
                                navController.navigate(screen.route) {
                                    popUpTo(navController.graph.startDestinationId) {
                                        saveState = true
                                    }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            }
                        )
                    }
                }
            }
        ) { innerPadding ->
            NavHost(
                navController = navController,
                startDestination = Screen.Dashboard.route,
                modifier = Modifier.padding(innerPadding)
            ) {
                composable(Screen.Dashboard.route) {
                    DashboardScreen(
                        onOpenHotels = {
                            navController.navigate(Screen.Hotels.route) {
                                launchSingleTop = true
                                restoreState = true
                            }
                        }
                    )
                }
                composable(Screen.Tours.route) { ToursScreen() }
                composable(Screen.Report.route) { TagesfahrblattScreen() }
                composable(Screen.Stats.route) { MonthlyStatsScreen() }
                composable(Screen.Costs.route) { CostsScreen() }
                composable(Screen.Hotels.route) { HotelsScreen() }
                composable(Screen.Chat.route) { ChatScreen() }
                composable(Screen.Profile.route) { ProfileScreen() }
                composable(Screen.Settings.route) { SettingsScreen() }
            }
        }
    }
}
