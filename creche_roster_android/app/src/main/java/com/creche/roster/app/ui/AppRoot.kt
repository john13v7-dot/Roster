package com.creche.roster.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.creche.roster.app.data.AppState
import com.creche.roster.app.data.Repository
import com.creche.roster.app.ui.screens.ChecksScreen
import com.creche.roster.app.ui.screens.HistoryScreen
import com.creche.roster.app.ui.screens.LeaveScreen
import com.creche.roster.app.ui.screens.OverridesScreen
import com.creche.roster.app.ui.screens.RosterScreen
import com.creche.roster.app.ui.screens.SettingsScreen
import com.creche.roster.app.ui.screens.StaffScreen
import com.creche.roster.app.ui.screens.TotalsScreen
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppRoot() {
    val context = LocalContext.current
    var current by remember { mutableStateOf<Screen>(Screen.Roster) }
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()

    // Every change to the inputs is saved straight away, so nothing is lost
    // if the app is closed or the phone rotates.
    val currentInputs = AppState.inputs.value
    LaunchedEffect(currentInputs) {
        currentInputs?.let { Repository.save(context, it) }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet {
                Spacer(Modifier.height(12.dp))
                Text(
                    "Creche Roster",
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.padding(16.dp),
                )
                HorizontalDivider()
                Screen.ALL.forEach { screen ->
                    NavigationDrawerItem(
                        label = { Text(screen.title) },
                        selected = current == screen,
                        onClick = {
                            current = screen
                            scope.launch { drawerState.close() }
                        },
                        modifier = Modifier.padding(horizontal = 12.dp),
                    )
                }
            }
        },
    ) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text(current.title) },
                    navigationIcon = {
                        IconButton(onClick = { scope.launch { drawerState.open() } }) {
                            Icon(Icons.Filled.Menu, contentDescription = "Menu")
                        }
                    },
                )
            },
        ) { padding ->
            Box(modifier = Modifier.padding(padding).fillMaxSize()) {
                when (current) {
                    Screen.Roster -> RosterScreen()
                    Screen.Staff -> StaffScreen()
                    Screen.Leave -> LeaveScreen()
                    Screen.Overrides -> OverridesScreen()
                    Screen.Settings -> SettingsScreen()
                    Screen.History -> HistoryScreen()
                    Screen.Checks -> ChecksScreen()
                    Screen.Totals -> TotalsScreen()
                }
            }
        }
    }
}
