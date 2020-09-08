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
var windowsAddedBySync = []; // Array of Object. [ { wid: 'aabbaabb', id: 1 }, { wid: 'ccddccdd' } ]
var windowsRemovedBySync = []; // Array of id.
var tabsAddedBySync = []; // Array of Object.
var tabsRemovedBySync = []; // Array of id.
var tabsRemovedByWindowClose = []; // Not sure if we need this.
var tabsUpdatedBySync = []; // Array of id.
var tabsMovedBySync = []; // Array of id.
var syncInProcess = false;

var newTabUrl = "chrome://newtab/";

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

// When windowCreateHandler is triggered, there is no way that we
// can decide whether the window was created by user, or it was
// created by sync handler because a new window was created from
// another device. For the latter case, we should not sync newly
// created window to other devices - it isn't a original window, but
// a copied window. So in order to decide that, I created a list
// called 'windowsAddedBySync'. Before creating a new window in the
// sync handler, we push the 'wid' of synced window to the list. In
// the callback function of chrome.windows.create, we tag the
// previously pushed entry with the window ID. The windowCreateHandler
// checks if windowsAddedBySync list has element, and wait until all
// elements have been tagged with a window ID. If there is a matching
// window ID for the newly created window that triggered
// windowCreateHandler, we can decied that the window was created by
// sync handler, so we don't need to sync that window with other
// devices.
function windowCreateHandler(window) {
	console.log('windowCreateHandler: ', window);
	if (windowsAddedBySync.length > 0) {
		if (!windowsAddedBySync.every(obj => {
			return (typeof obj.id != "undefined");
		})) {
			console.log('wait for all elements tagged with window ID');
			setTimeout(() => {
				windowCreateHandler(window);
			}, 500);
		} else {
			// Check if there is no matching window ID
			if (windowsAddedBySync.every(obj => {
				return (obj.id != window.id);
			})) { // This window is created by user, not sync handler.
				console.log('window created by user');
				windowCreateByUserHandler(window);
			} else { // This window is created by sync handler, thus no need to sync it.
				// Remove corresponding entry from 'windowsAddedBySync' list.
				console.log('window created by sync handler');
				windowsAddedBySync.splice(windowsAddedBySync.findIndex(obj => obj.id == window.id), 1);
			}
		}
	} else {
		console.log('window created by user(length == 0)');
		windowCreateByUserHandler(window);
	}
}

// TODO: Ask if user want to sync this window?
// When a new window is created, we should check
// if it's the first window/tab created across our
// synced devices. If it is the first one, start
// syncing and if not, sync to other device's
// current tabs.
function windowCreateByUserHandler(window) {
	console.log("windowCreateByUserHandler: ", window);
	getCurrentWindowCount().then(count => {
		// First created window.
		if (count == 1) {
			chrome.storage.sync.get(['windows'], result => {
				// Other device is running tabs that should be synced.
				if (typeof result.windows != "undefined") {
					syncAllWindows(window);
				} else { // No other device is running.
					syncAddedWindow(window);
				}
			});
		} else {
			syncAddedWindow(window);
		}
	});
}

// TODO: Ask for sync clear if it's the last window.
// When window is removed, we should decide if the user
// wants to actually close all opened tabs or just shutting
// the program down until the user starts to use it again.
function windowRemoveHandler(windowId) {
	console.log("windowRemoveHandler: ", windowId);
	if (windowsRemovedBySync.includes(windowId)) {
		console.log("window removed by sync handler: ", windowId);
		windowsRemovedBySync.splice(windowsRemovedBySync.indexOf(windowId), 1);
	} else {
		getCurrentWindowCount().then(count => {
			if (count == 0) {
				console.log("last window removed by user: ", windowId);
				clearSyncInfo();
			} else {
				console.log("window removed by user: ", windowId);
				syncRemovedWindow(windowId);
			}
		});
	}
}

function tabCreateHandler(tab) {
	console.log('tabCreateHandler: ', tab);
	console.log("tabsAddedBySync: ", tabsAddedBySync);
	if (tabsAddedBySync.length > 0) {
		if (!tabsAddedBySync.every(obj => {
			return (typeof obj.id != "undefined");
		})) {
			console.log('wait for all elements tagged with tab ID');
			setTimeout(() => {
				tabCreateHandler(tab);
			}, 500);
		} else {
			// Check if there is no matching tab ID
			if (tabsAddedBySync.every(obj => {
				return (obj.id != tab.id);
			})) { // This tab is created by user, not sync handler.
				console.log('tab created by user');
				tabCreateByUserHandler(tab);
			} else { // This tab is created by sync handler, thus no need to sync it.
				// Remove corresponding entry from 'tabsAddedBySync' list.
				console.log('tab created by sync handler');
				tabsAddedBySync.splice(tabsAddedBySync.findIndex(obj => obj.id == tab.id), 1);
			}
		}
	} else {
		console.log('tab created by user(length == 0)');
		tabCreateByUserHandler(tab);
	}
}

function tabCreateByUserHandler(tab) {
	console.log("tabCreateByUserHandler: ", tab);
	syncAddedTab(tab.id, tab.windowId, tab.url, tab.index);
}

function tabRemoveHandler(tabId, removeInfo) {
	console.log("tabRemoveHandler: " + tabId);
	if (removeInfo.isWindowClosing) {
		// Do nothing. windowRemoveHandler will handle this.
	} else if (tabsRemovedBySync.includes(tabId)) {
		console.log("tab removed by sync handler: ", tabId);
		tabsRemovedBySync.splice(tabsRemovedBySync.indexOf(tabId), 1);
	} else {
		console.log("tab removed by user: ", tabId);
		syncRemovedTab(tabId);
	}
}

// Handle URL changes. This event does NOT include
// tab moves (resposition in a window),
// or tab attach/detach (moved between windows).
function tabUpdateHandler(tabId, changeInfo, tab) {
	console.log("tabUpdateHandler: ", changeInfo);
	if (typeof changeInfo.url == "undefined") {
		// No change in tab url (e.g., tab reloaded, muted, ...). Skip this event.
		console.log("No change in tab url");
	} else if (tabsUpdatedBySync.includes(tabId)) {
		console.log("tab updated by sync handler: ", tabId);
		tabsUpdatedBySync.splice(tabsUpdatedBySync.indexOf(tabId), 1);
	} else {
		console.log("tab updated by user: ", tabId);
		syncUpdatedTab(tabId, changeInfo, tab);
	}
}

// Handle index changes. This event does NOT include
// tab attach/detach (tabs moved between windows).
function tabMoveHandler(tabId, moveInfo) {
	console.log("tabMoveHandler: ", moveInfo);
	if (tabsMovedBySync.includes(tabId)) {
		console.log("tab moved by sync handler: ", tabId);
		tabsMovedBySync.splice(tabsMovedBySync.indexOf(tabId), 1);
	} else {
		console.log("tab moved by user: ", tabId);
		syncMovedTab(tabId, moveInfo);
	}
}

// Handle tab detached (moved between windows)
function tabDetachHandler(tabId, detachInfo) {
	console.log("tabDetachHandler: ", detachInfo);
	if (tabsMovedBySync.includes(tabId)) {
		console.log("tab detached by sync handler: ", tabId);
		// Don't remove tabId from tabsRemovedBySync yet, because it should be handled in tabAttachHandler.
	} else {
		console.log("tab detached by user: ", tabId);
		// Don't sync this event, do it after the detached tab is attached to another window.
	}
}

// Handle tab attached (moved between windows)
function tabAttachHandler(tabId, attachInfo) {
	console.log("tabAttachHandler: ", attachInfo);
	if (tabsMovedBySync.includes(tabId)) {
		console.log("tab attached by sync handler: ", tabId);
		tabsMovedBySync.splice(tabsMovedBySync.indexOf(tabId), 1);
	} else {
		console.log("tab attached by user: ", tabId);
		syncAttachedTab(tabId, attachInfo);
	}
}

// Sync funcitons.
//
// Global sync info
// windows: {
//   wids: [ 'aabbaabb', ],
//   'aabbaabb': { tabs: [ 'ccddccdd', ] }
// }
//
// tabs: {
//   tids: [ 'ccddccdd', ],
//   'ccddccdd': {
//     wid: 'aabbaabb',
//     url: 'google.com',
//     pos: 1
//   }
// }
//
// Local window/tabb info
// windows: {
//   wids: [ 'aabbaabb', ],
//   'aabbaabb': {
//     id: 1,
//     tabs: [ 'ccddccdd', ]
//   }
// }
//
// tabs: {
//   tids: [ 'ccddccdd', ],
//   'ccddccdd': {
//     id: 1,
//     wid: 'aabbaabb',
//     url: 'google.com',
//     pos: 1
//   }
// }

function syncAllWindows(window) {
	console.log("syncAllWindows", window);
	if (syncInProcess) {
		setTimeout(() => {
			syncAllWindows(window);
		}, 500);
	} else {
		console.log("syncAllWindows started: ", window);
		syncInProcess = true;
		let localSyncInfo = {};
		let currentWindowSynced = false;
		chrome.storage.sync.get(['windows', 'tabs'], result => {
			return Promise.all(result.windows.wids.map(wid => {
				return new Promise((resolveWindowObject, rejectWindowObject) => {
					if (currentWindowSynced) {
						currnetWindowSynced = true;
						resolveWindowObject(window);
					} else {
						windowsAddedBySync.push({ wid: wid });
						chrome.windows.create({ type: "normal" }, windowObject => {
							windowsAddedBySync.find(obj => obj.wid == wid).id = windowObject.id;
							resolveWindowObject(windowObject)
						});
					}
				}).then(windowObject => {
					if (typeof localSyncInfo.windows == "undefined") {
						localSyncInfo.windows = {
							wids: []
						};
					}
					if (typeof localSyncInfo.tabs == "undefined") {
						localSyncInfo.tabs = {
							tids: []
						};
					}
					localSyncInfo.windows.wids.push(wid);
					localSyncInfo.windows[wid] = {
						id: window.id,
						wid: wid,
						tabs: []
					};
					return new Promise((resolveTabClear, rejectTabClear) => {
						if (typeof window.tabs != "undefined" ? window.tabs.length > 0 : false) { // Clear tabs in this window, before syncing
							// Let's not loop through an changing array.
							let tabIds = windows.tabs;
							return Promise.all(tabIds.map(tabId => {
								return new Promise((resolveTabRemove, rejectTabRemove) => {
									// Though this isn't because of another device removed a tab, we don't have to sync this event.
									tabsRemovedBySync.push(tabId);
									chrome.tabs.remove(tabId, () => resolveTabRemove());
								});
							})).then(() => resolveTabClear());
						} else {
							resolveTabClear();
						}
					}).then(() => {
						if (typeof result.windows[wid].tabs == "undefined" ? true : result.windows[wid].tabs.length == 0) {
							return;
						} else {
							return Promise.all(result.windows[wid].tabs.map(tid => {
								return new Promise((resolveTabCreate, rejectTabCreate) => {
									let url = result.tabs[tid].url;
									if (url == "") {
										url = newTabUrl;
									}
									tabsAddedBySync.push({ tid: tid });
									chrome.tabs.create({
										windowId: window.id,
										index: result.tabs[tid].pos,
										url: url
									}, tab => {
										tabsAddedBySync.find(obj => obj.tid == tid).id = tab.id;
										localSyncInfo.windows[wid].tabs.push(tid);
										localSyncInfo.tabs.tids.push(tid);
										localSyncInfo.tabs[tid] = {
											id: tab.id,
											tid: tid,
											wid: wid,
											pos: tab.index,
											url: tab.url
										};
										resolveTabCreate();
									});
								});
							}));
						}
					});
				});
			})).then(() => {
				chrome.storage.local.set({
					windows: localSyncInfo.windows,
					tabs: localSyncInfo.tabs
				}, () => {
					syncInProcess = false;
					console.log("syncAllWindows done");
				});
			});
		});
	}
}

function syncAddedWindow(window) {
	if (syncInProcess) {
		setTimeout(() => {
			syncAddedWindow(window);
		}, 500);
	} else {
		syncInProcess = true;
		console.log("syncAddedWindow started");
		let wid = generateUid(8);
		return new Promise((resolve, reject) => {
			chrome.storage.local.get(['windows'], result => {
				console.log('localSync: ' + result.windows);
				if (typeof result.windows == "undefined") {
					result.windows = {
						wids: []
					};
				}
				if (typeof result.windows.wids == "undefined") {
					result.windows.wids = [];
				}
				result.windows.wids.push(wid);
				result.windows[wid] = {
					id: window.id,
					wid: wid,
					tabs: [],
				}
				chrome.storage.local.set({
					windows: result.windows
				}, () => resolve());
			});
		}).then(() => {
			return new Promise((resolve, reject) => {
				chrome.storage.sync.get(['windows'], result => {
					console.log('globalSync: ' + result.windows);
					if (typeof result.windows == "undefined") {
						result.windows = {
							wids: []
						};
					}
					if (typeof result.windows.wids == "undefined") {
						result.windows.wids = [];
					}
					result.windows.wids.push(wid);
					result.windows[wid] = {
						wid: wid,
						tabs: [],
					}
					chrome.storage.sync.set({
						windows: result.windows
					}, () => resolve());
				});
			});
		}).then(() => {
			syncInProcess = false;
			console.log("syncAddedWindow done");
		});
	}
}

function syncRemovedWindow(windowId) {
	if (syncInProcess) {
		setTimeout(() => {
			syncRemovedWindow(windowId);
		}, 500);
	} else {
		syncInProcess = true;
		console.log("syncRemovedWindow started");
		let wid = '';
		return new Promise((resolve, reject) => {
			console.log('removeWindow: ' + windowId);
			logCurrentLocalSyncInfo();
			chrome.storage.local.get(['windows', 'tabs'], result => {
				console.log('localSync: ' + result.windows);
				if (typeof result.windows != "undefined") {
					wid = result.windows.wids.find(obj => {
						return result.windows[obj].id == windowId;
					});
					if (typeof result.windows[wid].tabs != "undefined" ? result.windows[wid].tabs.length != 0 : false) {
						result.windows[wid].tabs.forEach(tid => {
							if (result.tabs.tids.includes(tid)) {
								result.tabs.tids.splice(result.tabs.tids.indexOf(tid), 1);
							}
							if (typeof result.tabs[tid] != "undefined") {
								delete result.tabs[tid];
							}
						});
					}
					result.windows.wids.splice(result.windows.wids.indexOf(wid), 1);
					delete result.windows[wid];
					chrome.storage.local.set({
						windows: result.windows,
						tabs: result.tabs
					}, () => {
						logCurrentLocalSyncInfo();
						resolve();
					});
				}
			});
		}).then(() => {
			return new Promise((resolve, reject) => {
				logCurrentGlobalSyncInfo();
				chrome.storage.sync.get(['windows', 'tabs'], result => {
					console.log('globalSync: ' + result.windows);
					if (typeof result.windows != "undefined") {
						if (typeof result.windows[wid].tabs != "undefined" ? result.windows[wid].tabs.length != 0 : false) {
							result.windows[wid].tabs.forEach(tid => {
								if (result.tabs.tids.includes(tid)) {
									result.tabs.tids.splice(result.tabs.tids.indexOf(tid), 1);
								}
								if (typeof result.tabs[tid] != "undefined") {
									delete result.tabs[tid];
								}
							});
						}
						result.windows.wids.splice(result.windows.wids.indexOf(wid), 1);
						chrome.storage.sync.set({
							windows: result.windows,
							tabs: result.tabs
						}, () => {
							logCurrentGlobalSyncInfo();
							resolve();
						});
					}
				});
			});
		}).then(() => {
			syncInProcess = false;
			console.log("syncRemovedWindow done");
		});
	}
}

function syncAddedTab(tabId, windowId, url, index) {
	if (syncInProcess) {
		setTimeout(() => {
			syncAddedTab(tabId, windowId, url, index);
		}, 500);
	} else {
		syncInProcess = true;
		console.log("syncAddedTab started");
		let tid = generateUid(8);
		let wid = '';
		return new Promise((resolve, reject) => {
			chrome.storage.local.get(['windows', 'tabs'], result => {
				if (typeof result.windows == "undefined") {
					//syncInProcess = false;
					console.log("delaying syncAddedTab");
					setTimeout(() => {
						syncAddedTab(tabId, windowId, url, index);
					}, 500);
					resolve(false);
					return;
				} else {
					wid = result.windows.wids.find(obj => { // FIXME: cannot read 'find' of undefined
						return result.windows[obj].id == windowId;
					});
					if (typeof wid == "undefined") {
						console.log("delaying syncAddedTab");
						setTimeout(() => {
							syncAddedTab(tabId, windowId, url, index);
						}, 500);
						resolve(false);
						return;
					}
					if (!result.windows[wid].tabs.includes(tid)) {
						result.windows[wid].tabs.push(tid);
					}
					if (typeof result.tabs == "undefined") {
						result.tabs = {
							tids: []
						};
					}
					if (typeof result.tabs.tids == "undefined") {
						result.tabs.tids = [];
					}
					if (!result.tabs.tids.includes(tid)) {
						result.tabs.tids.push(tid);
					}
					result.tabs[tid] = {
						wid: wid,
						tid: tid,
						id: tabId,
						url: url,
						pos: index
					};
					chrome.storage.local.set({
						windows: result.windows,
						tabs: result.tabs
					}, () => resolve(true));
				}
			});
		}).then(keepGoing => {
			if (keepGoing) {
				return new Promise((resolve, reject) => {
					chrome.storage.sync.get(['windows', 'tabs'], result => {
						if (!result.windows[wid].tabs.includes(tid)) {
							result.windows[wid].tabs.push(tid);
						}
						if (typeof result.tabs == "undefined") {
							result.tabs = {
								tids: []
							};
						}
						if (typeof result.tabs.tids == "undefined") {
							result.tabs.tids = [];
						}
						if (!result.tabs.tids.includes(tid)) {
							result.tabs.tids.push(tid);
						}
						result.tabs[tid] = {
							tid: tid,
							wid: wid,
							url: url,
							pos: index
						};
						chrome.storage.sync.set({
							windows: result.windows,
							tabs: result.tabs
						}, () => resolve());
					});
				});
			} else {
				return;
			}
		}).then(() => {
			syncInProcess = false;
			console.log("syncAddedTab done");
		});
	}
}

function syncRemovedTab(tabId) {
	if (syncInProcess) {
		setTimeout(() => {
			syncRemovedTab(tabId);
		}, 500);
	} else {
		syncInProcess = true;
		console.log("syncRemovedTab started");
		let tid = '';
		let wid = '';
		return new Promise((resolve, reject) => {
			console.log('removeTab: ' + tabId);
			logCurrentLocalSyncInfo();
			chrome.storage.local.get(['windows', 'tabs'], result => {
				console.log('localSync: ' + result.windows);
				if (typeof result.windows != "undefined" && typeof result.tabs != "undefined") {
					tid = result.tabs.tids.find(obj => {
						return result.tabs[obj].id == tabId;
					});
					if (typeof result.tabs[tid] == "undefined") {
						console.log("Cannot find tab with tid: ", tid);
						reject();
						return;
					}
					wid = result.tabs[tid].wid;
					result.windows[wid].tabs.splice(result.windows[wid].tabs.indexOf(tid), 1);
					result.tabs.tids.splice(result.tabs.tids.indexOf(tid), 1);
					delete result.tabs[tid];
					chrome.storage.local.set({
						windows: result.windows,
						tabs: result.tabs
					}, () => {
						logCurrentLocalSyncInfo();
						resolve();
					});
				}
			});
		}).then(() => {
			return new Promise((resolve, reject) => {
				logCurrentGlobalSyncInfo();
				chrome.storage.sync.get(['windows', 'tabs'], result => {
					console.log('globalSync: ' + result.windows);
					if (typeof result.windows != "undefined") {
						result.windows[wid].tabs.splice(result.windows[wid].tabs.indexOf(tid), 1);
						result.tabs.tids.splice(result.tabs.tids.indexOf(tid), 1);
						delete result.tabs[tid];
						chrome.storage.sync.set({
							windows: result.windows,
							tabs: result.tabs
						}, () => {
							logCurrentGlobalSyncInfo();
							resolve();
						});
					}
				});
			});
		}).then(() => {
			syncInProcess = false;
			console.log("syncRemovedTab done");
		});
	}
}

function syncUpdatedTab(tabId, changeInfo, tab) {
	if (syncInProcess) {
		setTimeout(() => {
			syncUpdatedTab(tabId, changeInfo, tab);
		}, 500);
	} else {
		syncInProcess = true;
		console.log("syncUpdatedTab started");
		let tid = '';
		let wid = '';
		return new Promise((resolve, reject) => {
			console.log("changeInfo: ", changeInfo);
			chrome.storage.local.get(['tabs'], result => {
				console.log("localSync: ", result);
				tid = result.tabs.tids.find(obj => result.tabs[obj].id == tabId);
				result.tabs[tid].url = changeInfo.url;
				chrome.storage.local.set({
					tabs: result.tabs
				}, () => resolve());
			});
		}).then(() => {
			return new Promise((resolve, reject) => {
				chrome.storage.sync.get(['tabs'], result => {
					console.log("globalSync: " , result);
					result.tabs[tid].url = changeInfo.url;
					chrome.storage.sync.set({
						tabs: result.tabs
					}, () => resolve());
				});
			});
		}).then(() => {
			syncInProcess = false;
			console.log("syncUpdatedTab done");
		});
	}
}

function syncMovedTab(tabId, moveInfo) {
}

function syncAttachedTab(tabId, attachInfo) {
}

// Sync event handlers

function syncEventHandler(change, areaName) {
	// We don't want multiple sync handlers running at the same time.
	if (syncInProcess) {
		setTimeout(() => {
			syncEventHandler(change, areaName);
		}, 500);
	} else if (areaName == "sync") {
		syncInProcess = true;
		console.log('syncChange ', change);
		// Make whole codes as a promise for proper turning on/off of syncInProcess
		return new Promise((rootResolve, rootReject) => {
			// First get local sync info, to check if this event was triggered by local change.
			chrome.storage.local.get(['windows', 'tabs'], result => {
				console.log("result before sync: ", result);
				if (typeof change.windows == "undefined") { // Only tabs changed: tab update, move, attach/detach
					console.log("tab update, move, attach/detach: ", change.tabs);
					let promises = [];
					return new Promise((resolveTabsIter, rejectTabsIter) => {
						change.tabs.newValue.tids.forEach(tid => {
							if (result.tabs.tids.includes(tid) ? typeof result.tabs[tid] != "undefined" : false) {
								if (result.tabs[tid].url != change.tabs.newValue[tid].url) {
									let tabId = result.tabs[tid].id;
									tabsUpdatedBySync.push(tabId);
									promises.push(new Promise((resolve, reject) => {
										chrome.tabs.update(tabId, { url: change.tabs.newValue[tid].url }, tab => {
											result.tabs[tid].url = tab.url;
											resolve();
										});
									}));
								}
							}
						});
						resolveTabsIter(promises);
					}).then(promises => {
						return Promise.all(promises);
					}).then(() => {
						chrome.storage.local.set({
							tabs: result.tabs
						}, () => rootResolve());
					});
				} else if (typeof change.windows.oldValue == "undefined" &&
					typeof change.windows.newValue == "undefined") { // Shoudn't be a possible case
					console.log('exceptional change in syncInfo ', change);
					rootResolve();
				} else if (typeof change.windows.oldValue == "undefined") { // A fresh start.
					if (typeof result.windows == "undefined") { // Not local event. Another device just started a new Chrome process.
						console.log('Another machine created a new window (likely started a new Chrome process');
						result.windows = {};
						result.windows.wids = [];
						// Use Promise.all to set storage.local after handling all windows.
						return Promise.all(change.windows.newValue.wids.map(wid => {
							return new Promise((resolve, reject) => {
								windowsAddedBySync.push({ wid: wid });
								// Get the first tab, there should be at least one tab.
								if (change.windows.newValue[wid].tabs.length == 0) {
									console.log("Error!!!! Why no tab associated with this window? ", change.windows.newValue[wid]);
									reject();
									return;
								}
								let firstTid = change.windows.newValue[wid].tabs[0];
								if (typeof change.tabs.newValue[firstTid] == "undefined") {
									console.log("Error!!! Why this window's first tab not in sync.tabs?? ", change.tabs.newValue);
									reject();
									return;
								}
								let firstTab = change.tabs.newValue[firstTid];
								let firstUrl = firstTab.url;
								if (firstUrl == "") {
									firstUrl = newTabUrl;
								}
								tabsAddedBySync.push({ tid: firstTid });
								chrome.windows.create({
									type: "normal",
									url: firstUrl
								}, window => {
									windowsAddedBySync.find(obj => obj.wid == wid).id = window.id;
									result.windows.wids.push(wid);
									result.windows[wid] = {
										wid: wid,
										id: window.id,
										tabs: [firstTid]
									};
									if (typeof result.tabs == "undefined") {
										result.tabs = {
											tids: []
										};
									}
									if (typeof result.tabs.tids == "undefined") {
										result.tabs.tids = [];
									}
									if (window.tabs.length == 0) {
										console.log("Error!!! Why windows.tabs empty??? ", window.tabs);
									} else {
										console.log("Window successfully created with tab ", window.tabs);
										tabsAddedBySync.find(obj => obj.tid == firstTid).id = window.tabs[0].id;
										result.tabs.tids.push(firstTid);
										result.tabs[firstTid] = {
											id: window.tabs[0].id,
											tid: firstTid,
											wid: wid,
											url: firstUrl == newTabUrl ? "" : firstUrl,
											pos: 0
										};
									}
									if (change.windows.newValue[wid].tabs.length > 1) { // There are more tabs to create
										console.log("Also syncing tabs of the window created by another device");
										console.log("tabs: ", change.windows.newValue[wid].tabs);
										return Promise.all(change.windows.newValue[wid].tabs.map(tid => {
											if (change.windows.newValue[wid].tabs.indexOf(tid) == 0) { // Skip first tab, we already handled it.
												return;
											}
											tabsAddedBySync.push({ tid: tid });
											return new Promise((resolve2, reject2) => {
												let url = change.tabs.newValue[tid].url;
												if (url == "") {
													url = newTabUrl;
												}
												console.log("Syncing another device's tab: ", url);
												chrome.tabs.create({
													windowId: window.id,
													url: url,
													index: change.tabs.newValue[tid].pos
												}, tab => {
													tabsAddedBySync.find(obj => obj.tid == tid).id = tab.id;
													if (typeof result.tabs == "undefined") {
														result.tabs = {
															tids: []
														};
													}
													result.tabs.tids.push(tid); // FIXME: cannot read property tids of undefined
													result.tabs[tid] = {
														id: tab.id,
														tid: tid,
														wid: wid,
														pos: tab.index,
														url: tab.url 
													};
													result.windows[wid].tabs.push(tid);
													resolve2();
												})
											});
										})).then(() => resolve());
									} else {
										resolve();
									}
								});
							});
						})).then(() => {
							chrome.storage.local.set({
								windows: result.windows,
								tabs: result.tabs
							}, () => rootResolve());
						});
					} else { // Local event. User just started a new Chrome process.
						// Do nothing. All sync should have been done in windowCreateHandler.
						console.log('This device created a new window (likely started a new Chrome process)');
						rootResolve();
					}
				} else if (typeof change.windows.newValue == "undefined") { // All windows are gone.
					if (typeof result.windows == "undefined") { // Local event. User just exited the last window.
						// Do nothing. All sync should have been done in windowRemoveHandler.
						console.log("Seems like this device's Chrome has been shut down");
						// TODO: Is this ok?
						chrome.storage.local.clear(() => {
							chrome.storage.sync.clear(() => {
								rootResolve();
							});
						});
						//rootResolve();
					} else { // Not Local event. Another device just closed its (last) Chrome window.
						console.log("Another device just closed its (last) Chrome window");
						// Do not loop through an array while splicing it.
						let wids = result.windows.wids.map(wid => wid);
						return Promise.all(wids.map(wid => {
							let tabId = -1;
							console.log("Closing tabs for wid: ", wid);
							console.log("Tabs to be closed: ", result.windows[wid].tabs);
							// First, close all tabs attached to this window.
							let windowId = result.windows[wid].id;
							windowsRemovedBySync.push(windowId); // Closing all tab might remove the window, too
							// Looping through result.windows[wid].tabs and splice it in the loop caused wrong behavior.
							// FIXME: Correct other similar codes!!
							let tids = result.windows[wid].tabs.map(tid => tid);
							return Promise.all(tids.map(tid => {
								if (typeof result.tabs[tid] == "undefined") {
									console.log("Cannot find tab with tid: ", tid);
									return;
								}
								tabId = result.tabs[tid].id;
								console.log("Closing tab with tid: " + tid + ", tabId: " + tabId);
								tabsRemovedBySync.push(tabId);
								result.windows[wid].tabs.splice(result.windows[wid].tabs.indexOf(tid), 1);
								result.tabs.tids.splice(result.tabs.tids.indexOf(tid), 1);
								delete result.tabs[tid];
								return new Promise((resolve, reject) => {
									chrome.tabs.remove(tabId, () => {
										console.log("Closed tab with tid: ", tid);
										resolve();
									});
								});
							})).then(() => { // All tabs attached to this window are closed.
								console.log("Closed all tabs for window wid: " + wid + ", windowId: " + windowId);
								console.log("This window will be automatically shut down. If I manually remove that, it will cause the next new window to create previously existed tabs.");
								// This was handled above.
								//windowsRemovedBySync.push(windowId);
								result.windows.wids.splice(result.windows.wids.indexOf(wid), 1);
								delete result.windows[wid];
								// Do not chrome.windows.remove() here, because that somehow causes the next new window to create priviously existed tabs.
								return;
							});
						})).then(() => {
							/*chrome.storage.local.set({
								windows: result.widows,
								tabs: result.tabs
							}, () => rootResolve());*/
							// Let's just wipe storage
							chrome.storage.local.clear(() => {
								chrome.storage.sync.clear(() => {
									rootResolve();
								});
							});
						});
					}
				} else { // Window/tab created or removed.
					console.log("Window/tab created or removed");
					// First, check if there's a new window created.
					return Promise.all(change.windows.newValue.wids.map(wid => {
						if (!change.windows.oldValue.wids.includes(wid)) { // New window
							console.log("A new window created");
							if (typeof result.windows == "undefined" ? true : !result.windows.wids.includes(wid)) { // Not local event
								console.log("A new window created in another device");
								return new Promise((resolve, reject) => {
									windowsAddedBySync.push({ wid: wid });
									let firstTid = change.windows.newValue[wid].tabs[0];
									let firstUrl = change.tabs.newValue[firstTid].url;
									if (firstUrl == "") {
										firstUrl = newTabUrl;
									}
									tabsAddedBySync.push({ tid: firstTid });
									chrome.windows.create({
										type: "normal",
										url: firstUrl
									}, window => {
										windowsAddedBySync.find(obj => obj.wid == wid).id = window.id;
										tabsAddedBySync.find(obj => obj.tid == firstTid).id = window.tabs[0].id;
										result.windows.wids.push(wid);
										result.windows[wid] = {
											id: window.id,
											wid: wid,
											tabs: [firstTid]
										};
										if (typeof result.tabs == "undefined") {
											result.tabs = {
												tids: []
											};
										}
										if (typeof result.tabs.tids == "undefined") {
											result.tabs.tids = [];
										}
										result.tabs.tids.push(firstTid);
										result.tabs[firstTid] = {
											id: window.tabs[0].id,
											tid: firstTid,
											wid: wid,
											url: firstUrl,
											pos: 0
										};
										resolve();
									});
								});
							}
						}
					})).then(() => { // Then check if tab changed.
						return new Promise((resolveTabs, rejectTabs) => {
							let promises = [];
							if (typeof change.tabs != "undefined") {
								if (typeof change.tabs.newValue == "undefined") { // All tabs are gone.
									change.tabs.oldValue.tids.forEach(tid => {
										if (typeof result.tabs != "undefined") {
											if (result.tabs.tids.includes(tid)) {
												promises.push(new Promise((resolve, reject) => {
													let tabId = result.tabs[tid].id;
													let wid = result.tabs[tid].wid;
													tabsRemovedBySync.push(tabId);
													result.windows[wid].tabs.splice(result.windows[wid].tabs.indexOf(tid), 1);
													result.tabs.tids.splice(result.tabs.tids.indexOf(tid), 1);
													delete result.tabs[tid];
													chrome.tabs.remove(tabId, () => resolve());
												}));
											}
										}
									});
								} else if ( typeof change.tabs.oldValue == "undefined") { // All tabs are fresh.
									if (typeof result.tabs == "undefined") {
										result.tabs = {
											tids: []
										};
									} else if (typeof result.tabs.tids == "undefined") {
										result.tabs.tids = [];
									}
									change.tabs.newValue.tids.forEach(tid => {
										if (!result.tabs.tids.includes(tid)) { // Not local event, or already handled
											console.log("Another device created fresh tabs");
											promises.push(new Promise((resolve, reject) => {
												tabsAddedBySync.push({ tid: tid });
												let wid = change.tabs.newValue[tid].wid;
												let url = change.tabs.newValue[tid].url;
												if (url == "") {
													url = newTabUrl;
												}
												chrome.tabs.create({
													windowId: result.windows[wid].id,
													index: change.tabs.newValue[tid].pos,
													url: url
												}, tab => {
													tabsAddedBySync.find(obj => obj.tid == tid).id = tab.id;
													result.windows[wid].tabs.push(tid);
													result.tabs.tids.push(tid);
													result.tabs[tid] = {
														id: tab.id,
														tid: tid,
														wid: wid,
														pos: tab.index,
														url: tab.url
													};
													resolve();
												});
											}));
										}
									});
								} else {
									console.log("Some changes in tabs");
									change.tabs.newValue.tids.forEach(tid => { // First, look for new tabs.
										if (!change.tabs.oldValue.tids.includes(tid)) { // New tab created
											if (typeof result.tabs == "undefined" ? true : !result.tabs.tids.includes(tid)) { // Not local event, or already handled
												console.log("change: ");
												console.log(change);
												console.log("result: ");
												console.log(result);
												console.log("Another device created new tabs");
												if (typeof result.tabs == "undefined") {
													result.tabs = {
														tids: []
													};
												}
												promises.push(new Promise((resolve, reject) => {
													tabsAddedBySync.push({ tid: tid});
													let url = change.tabs.newValue[tid].url;
													if (url == "") {
														url = newTabUrl;
													}
													chrome.tabs.create({
														windowId: result.windows[change.tabs.newValue[tid].wid].id,
														index: change.tabs.newValue[tid].pos,
														url: url
													}, tab => {
														tabsAddedBySync.find(obj => obj.tid == tid).id = tab.id;
														result.windows[change.tabs.newValue[tid].wid].tabs.push(tid);
														result.tabs.tids.push(tid);
														result.tabs[tid] = {
															id: tab.id,
															tid: tid,
															wid: change.tabs.newValue[tid].wid,
															pos: tab.index,
															url: tab.url
														};
														resolve();
													});
												}));
											}
										}
									});
									change.tabs.oldValue.tids.forEach(tid => { // Look for removed tabs.
										if (!change.tabs.newValue.tids.includes(tid)) { // Tab removed
											if (typeof result.tabs == "undefined" ? false : result.tabs.tids.includes(tid)) { // Not local event
												console.log("Another device removed tabs");
												promises.push(new Promise((resolve, reject) => {
													let tabId = result.tabs[tid].id;
													tabsRemovedBySync.push(tabId);
													chrome.tabs.remove(tabId, () => {
														let wid = result.tabs[tid].wid;
														result.windows[wid].tabs.splice(result.windows[wid].tabs.indexOf(tid), 1);
														result.tabs.tids.splice(result.tabs.tids.indexOf(tid), 1);
														delete result.tabs[tid];
														resolve();
													});
												}));
											}
										}
									});
								}
							}
							resolveTabs(promises);
						}).then(promises => {
							return Promise.all(promises);
						});
					}).then(() => { // Check for removed windows
						return Promise.all(change.windows.oldValue.wids.map(wid => {
							if (!change.windows.newValue.wids.includes(wid)) { // Removed window
								if (typeof result.windows == "undefined" ? false : result.windows.wids.includes(wid)) { // Not local event
									console.log("Another device removed a window");
									if (result.windows[wid].tabs.length != 0) {
										console.log('Error!! Why there\'re tabs remaining??');
									}
									return new Promise((resolve, reject) => {
										if (typeof result.windows[wid] == "undefined") {
											console.log("Cannot find window with wid: ", wid);
											reject();
											return;
										}
										windowsRemovedBySync.push(result.windows[wid].id);
										chrome.windows.remove(result.windows[wid].id, () => {
											resolve();
										});
									});
								}
							}
						}));
					}).then(() => {
						chrome.storage.local.set({
							windows: result.windows,
							tabs: result.tabs
						}, () => rootResolve() );
					});
				}
			});
		}).then(() => {
			syncInProcess = false;
			console.log("Sync done");
		});
	} else {
		console.log('localChange ', change);
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

function clearSyncInfo() {
	if (syncInProcess) {
		setTimeout(() => {
			clearSyncInfo();
		}, 500);
	} else {
		syncInProcess = true;
		chrome.storage.local.clear(() => {
			chrome.storage.sync.clear(() => {
				syncInProcess = false;
			});
		});
	}
}

// Debug functions
function logCurrentLocalSyncInfo() {
	chrome.storage.local.get(['windows', 'tabs'], result => {
		console.log('LocalSyncInfo: ', result);
	});
}

function logCurrentGlobalSyncInfo() {
	chrome.storage.sync.get(['windows', 'tabs'], result => {
		console.log('GlobalSyncInfo: ', result);
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
chrome.tabs.onCreated.addListener(tabCreateHandler);
chrome.tabs.onRemoved.addListener(tabRemoveHandler);
chrome.tabs.onUpdated.addListener(tabUpdateHandler);
chrome.storage.onChanged.addListener(syncEventHandler);
