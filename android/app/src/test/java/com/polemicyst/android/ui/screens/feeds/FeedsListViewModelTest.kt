package com.polemicyst.android.ui.screens.feeds

import app.cash.turbine.test
import com.polemicyst.android.data.repository.FeedsRepository
import com.polemicyst.android.data.repository.VideoFeed
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class FeedsListViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var feedsRepository: FeedsRepository
    private lateinit var viewModel: FeedsListViewModel

    private val sampleFeeds = listOf(
        VideoFeed(
            id = "1",
            name = "Test Feed",
            sourceUrl = "https://example.com/feed",
            sourceType = "youtube",
            createdAt = "2025-01-01T00:00:00Z",
            updatedAt = "2025-01-01T00:00:00Z",
        ),
        VideoFeed(
            id = "2",
            name = "Another Feed",
            sourceUrl = "https://example.com/feed2",
            sourceType = "rss",
            createdAt = "2025-01-02T00:00:00Z",
            updatedAt = "2025-01-02T00:00:00Z",
        ),
    )

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        feedsRepository = mockk()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `initial load fetches feeds successfully`() = runTest(testDispatcher) {
        coEvery { feedsRepository.getFeeds() } returns Result.success(sampleFeeds)

        viewModel = FeedsListViewModel(feedsRepository)

        viewModel.uiState.test {
            // Initial loading state
            val loading = awaitItem()
            assertTrue(loading.isLoading)

            // Loaded state
            val loaded = awaitItem()
            assertFalse(loaded.isLoading)
            assertEquals(2, loaded.feeds.size)
            assertEquals("Test Feed", loaded.feeds[0].name)
            assertNull(loaded.error)
        }
    }

    @Test
    fun `load feeds shows error on failure`() = runTest(testDispatcher) {
        coEvery { feedsRepository.getFeeds() } returns Result.failure(RuntimeException("Network error"))

        viewModel = FeedsListViewModel(feedsRepository)

        viewModel.uiState.test {
            // Initial loading state
            val loading = awaitItem()
            assertTrue(loading.isLoading)

            // Error state
            val error = awaitItem()
            assertFalse(error.isLoading)
            assertEquals("Network error", error.error)
            assertTrue(error.feeds.isEmpty())
        }
    }

    @Test
    fun `delete feed reloads list on success`() = runTest(testDispatcher) {
        coEvery { feedsRepository.getFeeds() } returns Result.success(sampleFeeds)
        coEvery { feedsRepository.deleteFeed("1") } returns Result.success(Unit)

        viewModel = FeedsListViewModel(feedsRepository)

        viewModel.uiState.test {
            skipItems(2) // Skip initial load + loaded state

            viewModel.deleteFeed("1")

            // Should trigger reload: loading then loaded
            val reloading = awaitItem()
            assertTrue(reloading.isLoading)

            val reloaded = awaitItem()
            assertFalse(reloaded.isLoading)
        }
    }
}
