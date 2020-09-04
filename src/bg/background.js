// if you checked "fancy-settings" in extensionizr.com, uncomment this lines

// var settings = new Store("settings", {
//     "sample_setting": "This is how you use Store.js to remember values"
// });


//example of using a message handler from the inject scripts
/*chrome.extension.onMessage.addListener(
  function(request, sender, sendResponse) {
  	chrome.pageAction.show(sender.tab.id);
    sendResponse();
  });*/
var syncRemovedWindows = [];

function getCurrentWindowCount() {
	var getInfo = {
		populate: true,
		windowTypes: ['normal'],
	};
	var windowCount = 0;
	return new Promise((resolve, reject) => {
		chrome.windows.getAll(getInfo, windows => {
			resolve(windows.length);
		});
	});
}

function logCurrentWindowCount() {
	getCurrentWindowCount().then(count => {
		console.log('window count: ' + count);
	});
}

// Handlers for window/tab events.

// When a new window is created, we should check
// if it's the first window/tab created across our
// synced devices. If it is the first one, start
// syncing and if not, sync to other device's
// current tabs.
function windowCreateHandler(window) {
	getCurrentWindowCount().then(count => {
		// First created window.
		if (count == 1) {
			chrome.storage.sync.get(['syncStarted'], result => {
				// Other device is running tabs that should be synced.
				if (result.syncStarted) {
					syncAllWindows(window);
				} else { // No other device is running.
					chrome.storage.local.set({
						windows: [],
					});
					chrome.storage.sync.set({
						syncStarted: true,
						windows: []
					});
					addWindow(window);
				}
			});
		} else {
			addWindow(window);
		}
	});
}

// When window is removed, we should decide if the user
// wants to actually close all opened tabs or just shutting
// the program down until the user starts to use it again.
function windowRemoveHandler(windowId) {
	if (syncRemovedWindows.includes(windowId)) {
		syncRemovedWindows.splice(syncRemovedWindows.indexOf(windowId), 1);
	} else if (confirm('Remove these tabs from sync?')) {
		getCurrentWindowCount().then(count => {
			if (count == 0) {
				chrome.storage.sync.set({
					syncStarted: false
				});
			}
		});
		removeWindow(windowId);
	} else {
		// Do nothing, we don't want to trigger sync
		// if the user is just shutting the program
		// down until future use.
	}
}

function tabCreateHandler(tab) {
	addTab(tab.id, tab.windowId, tab.url);
}

function tabRemoveHandler(tabId, removeInfo) {
	if (removeInfo.isWindowClosing) {
		// Do nothing. windowRemoveHandler will handle this.
	} else {
		chrome.tabs.get(tabId, tab => {
			removeTab(tab.id, tab.windowId);
		});
	}
}

// Sync funcitons.
//
// Global sync info
// [ { tabs: [ { url: google.com }, ] }, ]
//
// Local window/tabb info
// [ { id: 1, tabs: [ { id: 1, windowId: 1, url: google.com }, ] }, ]

function syncAllWindows(window) {
	console.log('syncAllWindows');
	chrome.storage.sync.get(['windows'], result => {
		var newWindows = [];
		result.windows.forEach((windowObject, windowIndex, windowArr) => {
			if (windowIndex == 0) {
				let newTabs = [];
				windowObject.tabs.forEach((tabObject, tabIndex, tabArr) => {
					chrome.tabs.create({
						url: tabObject.url,
						windowId: window.id
					}, createdTab => {
						newTabs.push({
							id: createdTab.id,
							windowId: window.id,
							url: createdTab.url
						});
					});
				});
				newWindows.push({
					id: window.id,
					tabs: newTabs
				});
			} else {
				let newTabs = [];
				chrome.windows.create({
					type: "normal"
				}, createdWindow => {
					windowObject.tabs.forEach((tabObject, tabIndex, tabArr) => {
						chrome.tabs.create({
							url: tabObject.url,
							windowId: createWindow.id
						}, createdTab => {
							newTabs.push({
								id: createdTab.id,
								windowId: createdWindow.id,
								url: createdTab.url
							});
						});
					});
					newWindows.push({
						id: createdWindow.id,
						tabs: newTabs
					});
				});
			}
		});
		chrome.storage.local.set({
			windows: newWindows
		});
	});
}

function addWindow(window) {
	chrome.storage.local.get(['windows'], result => {
		console.log('localSync: ' + result.windows);
		result.windows.push({
			id: window.id,
			tabs: []
		});
		chrome.storage.local.set({
			windows: result.windows
		});
	});
	chrome.storage.sync.get(['windows'], result => {
		console.log('globalSync: ' + result.windows);
		result.windows.push({
			tabs: []
		});
		chrome.storage.sync.set({
			windows: result.windows
		});
	});
}

function removeWindow(windowId) {
	var foundIndex = -1;
	console.log('removeWindow: ' + windowId);
	logCurrentLocalSyncInfo();
	chrome.storage.local.get(['windows'], result => {
		console.log('localSync: ' + result.windows);
		if (typeof result.windows != "undefined") {
			foundIndex = result.windows.findIndex((obj => obj.id == windowId));
			result.windows.splice(foundIndex, 1);
			chrome.storage.local.set({
				windows: result.windows
			}, () => {
				logCurrentLocalSyncInfo();
			});
		}
	});
	logCurrentGlobalSyncInfo();
	chrome.storage.sync.get(['windows'], result => {
		console.log('globalSync: ' + result.windows);
		if (typeof result.windows != "undefined") {
			result.windows.splice(foundIndex, 1);
			chrome.storage.sync.set({
				windows: result.windows
			}, () => {
				logCurrentGlobalSyncInfo();
			});
		}
	});
}

function addTab(tabId, windowId, url) {
}

function removeTab(tabId, windowID) {
}

// Sync event handlers

function syncEventHandler(change, areaName) {
	if (areaName == "sync" && typeof change.windows != "undefined") {
		console.log('sync change: ', change);
		chrome.storage.local.get(['windows'], result => {
			if (change.windows.newValue.length != result.windows.length) { // If window created/removed
				if (change.windows.newValue.length > change.windows.oldValue.length) { // A new window created
					chrome.windows.create({
						type: "normal"
					}, window => {
						result.windows.push({
							id: window.id,
							tabs: []
						});
						chrome.storage.local.set({
							windows: result.windows
						});
					});
				} else { // A window removed
					for (var i = 0; i < change.windows.oldValue.length; i++) {
						if (change.windows.oldValue[i] != change.windows.newValue[i]) {
							chrome.storage.local.get(['windows'], result => {
								syncRemovedWindows.push(result.windows[i].id);
								chrome.windows.remove(result.windows[i].id);
								result.windows.splice(i, 1);
								chrome.storage.local.set({
									windows: result.windows
								});
							});
							break;
						}
					}
				}
			}
		});
	}
}

// Debug functions
function logCurrentLocalSyncInfo() {
	chrome.storage.local.get(['windows'], result => {
		console.log('LocalSyncInfo: ', result.windows);
	});
}

function logCurrentGlobalSyncInfo() {
	chrome.storage.sync.get(['windows'], result => {
		console.log('GlobalSyncInfo: ', result.windows);
	});
}

function wipeLocalSyncInfo() {
	chrome.storage.local.set({
		windows: []
	});
}

function wipeGlobalSyncInfo() {
	chrome.storage.sync.set({
		windows: [],
		syncStarted: false
	});
}

chrome.windows.onCreated.addListener(windowCreateHandler);
chrome.windows.onRemoved.addListener(windowRemoveHandler);
chrome.storage.onChanged.addListener(syncEventHandler);
