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
var windowsRemovedBySync = [];

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
			chrome.storage.sync.get(['windows'], result => {
				// Other device is running tabs that should be synced.
				if (typeof result.windows != "undefined") {
					syncAllWindows(window);
				} else { // No other device is running.
					chrome.storage.local.set({
						windows: [],
					});
					chrome.storage.sync.set({
						windows: []
					});
					syncAddedWindow(window);
				}
			});
		} else {
			syncAddedWindow(window);
		}
	});
}

// When window is removed, we should decide if the user
// wants to actually close all opened tabs or just shutting
// the program down until the user starts to use it again.
function windowRemoveHandler(windowId) {
	if (windowsRemovedBySync.includes(windowId)) {
		windowsRemovedBySync.splice(windowsRemovedBySync.indexOf(windowId), 1);
	} else if (confirm('Remove these tabs from sync?')) {
		getCurrentWindowCount().then(count => {
			if (count == 0) {
				chrome.storage.local.clear();
				chrome.storage.sync.clear();
			} else {
				syncRemovedWindow(windowId);
			}
		});
	} else {
		// Do nothing, we don't want to trigger sync
		// if the user is just shutting the program
		// down until future use.
	}
}

function tabCreateHandler(tab) {
	syncAddedTab(tab.id, tab.windowId, tab.url);
}

function tabRemoveHandler(tabId, removeInfo) {
	if (removeInfo.isWindowClosing) {
		// Do nothing. windowRemoveHandler will handle this.
	} else {
		chrome.tabs.get(tabId, tab => {
			syncRemovedTab(tab.id, tab.windowId);
		});
	}
}

// Sync funcitons.
//
// Global sync info
// [ { wid: 'aabbaabb', tabs: [ { tid: 'ccddccdd', url: google.com }, ] }, ]
//
// Local window/tabb info
// [ { wid: 'aabbaabb', id: 1, tabs: [ { tid: 'ccddccdd', id: 1, windowId: 1, url: google.com }, ] }, ]

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

function syncAddedWindow(window) {
	let wid = generateUid(8);
	chrome.storage.local.get(['windows'], result => {
		console.log('localSync: ' + result.windows);
		result.windows.push({
			wid: wid,
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
			wid: wid,
			tabs: []
		});
		chrome.storage.sync.set({
			windows: result.windows
		});
	});
}

function syncRemovedWindow(windowId) {
	let wid = '';
	console.log('removeWindow: ' + windowId);
	logCurrentLocalSyncInfo();
	chrome.storage.local.get(['windows'], result => {
		console.log('localSync: ' + result.windows);
		if (typeof result.windows != "undefined") {
			let foundIndex = result.windows.findIndex((obj => obj.id == windowId));
			wid = result.windows[foundIndex].wid;
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
			let foundIndex = result.windows.findIndex((obj => obj.wid == wid));
			result.windows.splice(foundIndex, 1);
			chrome.storage.sync.set({
				windows: result.windows
			}, () => {
				logCurrentGlobalSyncInfo();
			});
		}
	});
}

function syncAddedTab(tabId, windowId, url) {
}

function syncRemovedTab(tabId, windowID) {
}

// Sync event handlers

function syncEventHandler(change, areaName) {
	if (areaName == "sync" && typeof change.windows != "undefined") {
		console.log('sync change: ', change);
		if (typeof change.windows.oldValue == "undefined") { // If this is the fresh start
			let newWindows = [];
			change.windows.newValue.forEach(windowToCreate => {
				chrome.windows.create({
					type: "normal"
				}, createdWindow => {
					newWindows.push({
						id: createdWindow.id,
						wid: windowToCreate.wid,
						tabs: []
					});
				});
			});
			chrome.storage.local.set({
				windows: newWindows
			});
		} else {
			chrome.storage.local.get(['windows'], result => {
				if (typeof change.windows.newValue == "undefined") { // If all windows are gone
					if (typeof result.windows == "undefined") { // Local windows are gone, too. That is, this event was probably triggered by local event.
						return;
					}
					// Use Promise.all to ensure that all windows are removed before wiping storage.local.
					Promise.all(result.windows.map(window => {
						windowsRemovedBySync.push(window.id);
						return new Promise((resolve, reject) => {
							chrome.windows.remove(window.id, () => resolve());
						});
					})).then(() => {
						chrome.storage.local.clear();
					});
				} else if (change.windows.newValue.length == result.windows.length) { // Nothing to sync. Handler probably triggered by local event.
					// Do nothing
				} else { // If window created/removed
					if (change.windows.newValue.length > change.windows.oldValue.length) { // A new window created
						let diffWindow = change.windows.newValue.find(window => {
							return change.windows.oldValue.every(window2 => {
								return window2.wid != window.wid;
							});
						});
						// TODO: Improve this.
						// Temporarily disable event listener for window created, becasuse
						// created window causes event listener to add created window to syncInfo.
						// Hope this does not cause any problem...
						chrome.windows.onCreated.removeListener(windowCreateHandler);
						chrome.windows.create({
							type: "normal"
						}, window => {
							// Now turn event listner back on.
							chrome.windows.onCreated.addListener(windowCreateHandler);
							result.windows.push({
								wid: diffWindow.wid,
								id: window.id,
								tabs: []
							});
							chrome.storage.local.set({
								windows: result.windows
							});
						});
					} else if (change.windows.newValue.length < change.windows.oldValue.length) { // A window removed
						let diffWindow = change.windows.oldValue.find(window => {
							return change.windows.newValue.every(window2 => {
								return window2.wid != window.wid;
							});
						});
						let windowToRemove = result.windows.find(obj => obj.wid == diffWindow.wid);
						windowsRemovedBySync.push(windowToRemove.id);
						chrome.windows.remove(windowToRemove.id, () => {
							result.windows.splice(result.windows.indexOf(windowToRemove), 1);
							chrome.storage.local.set({
								windows: result.windows
							});
						});
					}
				}
			});
		}
	}
}

// Helper, util functions

// ref: https://codepen.io/code_monk/pen/FvpfI
function generateUid(len) {
	var maxlen = 8,
		min = Math.pow(16,Math.min(len,maxlen)-1) 
	max = Math.pow(16,Math.min(len,maxlen)) - 1,
		n   = Math.floor( Math.random() * (max-min+1) ) + min,
		r   = n.toString(16);
	while (r.length < len) {
		r = r + generateUid(len - maxlen);
	}
	return r;
};

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
	chrome.storage.local.clear();
}

function wipeGlobalSyncInfo() {
	chrome.storage.sync.clear();
}

chrome.windows.onCreated.addListener(windowCreateHandler);
chrome.windows.onRemoved.addListener(windowRemoveHandler);
chrome.storage.onChanged.addListener(syncEventHandler);
