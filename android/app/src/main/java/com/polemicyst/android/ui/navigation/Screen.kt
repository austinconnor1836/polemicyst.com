package com.polemicyst.android.ui.navigation

sealed class Screen(val route: String) {
    data object Login : Screen("login")
    data object Feeds : Screen("feeds")
    data object FeedDetail : Screen("feeds/{feedId}") {
        fun createRoute(feedId: String) = "feeds/$feedId"
    }
    data object VideoDetail : Screen("feedVideos/{feedVideoId}/detail") {
        fun createRoute(feedVideoId: String) = "feedVideos/$feedVideoId/detail"
    }
    data object ClipList : Screen("feedVideos/{feedVideoId}/clips") {
        fun createRoute(feedVideoId: String) = "feedVideos/$feedVideoId/clips"
    }
    data object ClipEditor : Screen("clips/{clipId}/edit") {
        fun createRoute(clipId: String) = "clips/$clipId/edit"
    }
    data object ClipsGenie : Screen("clips-genie")
}
