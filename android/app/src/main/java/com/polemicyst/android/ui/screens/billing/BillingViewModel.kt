package com.polemicyst.android.ui.screens.billing

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.polemicyst.android.data.repository.SubscriptionInfo
import com.polemicyst.android.data.repository.SubscriptionRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class BillingUiState(
    val isLoading: Boolean = true,
    val subscription: SubscriptionInfo? = null,
    val error: String? = null,
)

@HiltViewModel
class BillingViewModel @Inject constructor(
    private val subscriptionRepository: SubscriptionRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(BillingUiState())
    val uiState: StateFlow<BillingUiState> = _uiState.asStateFlow()

    init {
        loadSubscription()
    }

    fun loadSubscription() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            subscriptionRepository.refresh()
                .onSuccess { info ->
                    _uiState.value = BillingUiState(isLoading = false, subscription = info)
                }
                .onFailure { e ->
                    _uiState.value = BillingUiState(
                        isLoading = false,
                        error = e.message ?: "Failed to load subscription",
                    )
                }
        }
    }
}
