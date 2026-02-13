package com.polemicyst.android.ui.navigation

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.RssFeed
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.navigation.navDeepLink
import com.polemicyst.android.ui.screens.clipeditor.ClipEditorScreen
import com.polemicyst.android.ui.screens.clips.ClipListScreen
import com.polemicyst.android.ui.screens.clipsgenie.ClipsGenieScreen
import com.polemicyst.android.ui.screens.feeddetail.FeedDetailScreen
import com.polemicyst.android.ui.screens.feeds.FeedsListScreen
import com.polemicyst.android.ui.screens.login.LoginScreen
import com.polemicyst.android.ui.screens.videodetail.VideoDetailScreen

private data class BottomNavItem(
    val screen: Screen,
    val label: String,
    val icon: ImageVector,
)

private val bottomNavItems = listOf(
    BottomNavItem(Screen.Feeds, "Feeds", Icons.Filled.RssFeed),
    BottomNavItem(Screen.ClipsGenie, "Clips Genie", Icons.Filled.AutoAwesome),
)

@Composable
fun AppNavGraph() {
    val navController = rememberNavController()
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = navBackStackEntry?.destination

    // Show bottom bar only on top-level screens after login
    val showBottomBar = currentDestination?.hierarchy?.any { dest ->
        dest.route == Screen.Feeds.route || dest.route == Screen.ClipsGenie.route
    } == true

    Scaffold(
        bottomBar = {
            if (showBottomBar) {
                NavigationBar {
                    bottomNavItems.forEach { item ->
                        NavigationBarItem(
                            icon = { Icon(item.icon, contentDescription = item.label) },
                            label = { Text(item.label) },
                            selected = currentDestination?.hierarchy?.any { it.route == item.screen.route } == true,
                            onClick = {
                                navController.navigate(item.screen.route) {
                                    popUpTo(Screen.Feeds.route) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            }
                        )
                    }
                }
            }
        }
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = Screen.Login.route,
            modifier = Modifier.padding(innerPadding),
        ) {
            composable(Screen.Login.route) {
                LoginScreen(
                    onLoginSuccess = {
                        navController.navigate(Screen.Feeds.route) {
                            popUpTo(Screen.Login.route) { inclusive = true }
                        }
                    }
                )
            }

            composable(
                route = Screen.Feeds.route,
                deepLinks = listOf(
                    navDeepLink { uriPattern = "https://polemicyst.com/feeds" }
                ),
            ) {
                FeedsListScreen(
                    onFeedClick = { feedId ->
                        navController.navigate(Screen.FeedDetail.createRoute(feedId))
                    }
                )
            }

            composable(Screen.ClipsGenie.route) {
                ClipsGenieScreen()
            }

            composable(
                route = Screen.FeedDetail.route,
                arguments = listOf(navArgument("feedId") { type = NavType.StringType })
            ) { backStackEntry ->
                val feedId = backStackEntry.arguments?.getString("feedId") ?: return@composable
                FeedDetailScreen(
                    feedId = feedId,
                    onVideoClick = { feedVideoId ->
                        navController.navigate(Screen.VideoDetail.createRoute(feedVideoId))
                    },
                    onBack = { navController.popBackStack() }
                )
            }

            composable(
                route = Screen.VideoDetail.route,
                arguments = listOf(navArgument("feedVideoId") { type = NavType.StringType }),
                deepLinks = listOf(
                    navDeepLink { uriPattern = "https://polemicyst.com/details/{feedVideoId}" }
                ),
            ) { backStackEntry ->
                val feedVideoId = backStackEntry.arguments?.getString("feedVideoId") ?: return@composable
                VideoDetailScreen(
                    feedVideoId = feedVideoId,
                    onClipClick = { clipId ->
                        navController.navigate(Screen.ClipEditor.createRoute(clipId))
                    },
                    onBack = { navController.popBackStack() }
                )
            }

            composable(
                route = Screen.ClipList.route,
                arguments = listOf(navArgument("feedVideoId") { type = NavType.StringType }),
            ) { backStackEntry ->
                val feedVideoId = backStackEntry.arguments?.getString("feedVideoId") ?: return@composable
                ClipListScreen(
                    feedVideoId = feedVideoId,
                    onClipClick = { clipId ->
                        navController.navigate(Screen.ClipEditor.createRoute(clipId))
                    },
                    onBack = { navController.popBackStack() }
                )
            }

            composable(
                route = Screen.ClipEditor.route,
                arguments = listOf(navArgument("clipId") { type = NavType.StringType })
            ) { backStackEntry ->
                val clipId = backStackEntry.arguments?.getString("clipId") ?: return@composable
                ClipEditorScreen(
                    clipId = clipId,
                    onBack = { navController.popBackStack() }
                )
            }
        }
    }
}
