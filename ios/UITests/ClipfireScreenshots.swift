import XCTest

@MainActor
class ClipfireScreenshots: XCTestCase {

    let app = XCUIApplication()

    override func setUpWithError() throws {
        continueAfterFailure = false
        app.launchArguments += ["--screenshot-mode"]
        setupSnapshot(app)
        app.launch()
    }

    func testCaptureScreenshots() {
        // 1. Clips tab (default tab 0)
        sleep(1)
        snapshot("01_Clips")

        // 2. Accounts tab
        let accountsTab = app.tabBars.buttons["Accounts"]
        XCTAssertTrue(accountsTab.waitForExistence(timeout: 5))
        accountsTab.tap()
        sleep(1)
        snapshot("02_Accounts")

        // 3. Videos tab
        let videosTab = app.tabBars.buttons["Videos"]
        XCTAssertTrue(videosTab.waitForExistence(timeout: 5))
        videosTab.tap()
        sleep(1)
        snapshot("03_Videos")

        // 4. Settings tab
        let settingsTab = app.tabBars.buttons["Settings"]
        XCTAssertTrue(settingsTab.waitForExistence(timeout: 5))
        settingsTab.tap()
        sleep(1)
        snapshot("04_Settings")
    }
}
