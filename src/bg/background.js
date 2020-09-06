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
var syncInProcess = false;

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
		console.log("windowRemoveHandler done (started by synced window)");
		windowsRemovedBySync.splice(windowsRemovedBySync.indexOf(windowId), 1);
	} else if (confirm('Remove these tabs from sync?')) {
		getCurrentWindowCount().then(count => {
			if (count == 0) {
				clearSyncInfo();
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
	console.log('tabCreateHandler: ', tab);
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
		tabsRemovedBySync.splice(tabsRemovedBySync.indexOf(tabId), 1);
	} else {
		syncRemovedTab(tabId);
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
						chrome.windows.create({ type: "normal" }, windowObject => resolveWindowObject(windowObject));
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
							return Promise.all(window.tabs.map(tabId => {
								return new Promise((resolveTabRemove, rejectTabRemove) => {
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
									chrome.tabs.create({
										windowId: window.id,
										index: result.tabs[tid].pos,
										url: result.tabs[tid].url
									}, tab => {
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
					result.windows.wids.splice(result.windows.wids.indexOf(wid), 1);
					delete result.windows[wid];
					chrome.storage.local.set({
						windows: result.windows
					}, () => {
						logCurrentLocalSyncInfo();
						resolve();
					});
				}
			});
		}).then(() => {
			return new Promise((resolve, reject) => {
				logCurrentGlobalSyncInfo();
				chrome.storage.sync.get(['windows'], result => {
					console.log('globalSync: ' + result.windows);
					if (typeof result.windows != "undefined") {
						result.windows.wids.splice(result.windows.wids.indexOf(wid), 1);
						chrome.storage.sync.set({
							windows: result.windows
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
					wid = result.windows.wids.find(obj => {
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
				if (typeof change.windows.oldValue == "undefined" &&
					typeof change.windows.newValue == "undefined") { // Shoudn't be a possible case
					console.log('exceptional change in syncInfo ', change);
					rootResolve();
				} else if (typeof change.windows.oldValue == "undefined") { // A fresh start.
					if (typeof result.windows == "undefined") { // Not local event. Another device just started a new Chrome process.
						console.log('Another machine created a new window (likely started a new Chrome process');
						result.windows = {};
						result.windows.wids = [];
						// Use Promise.all to set storage.local after handling all windows.
						Promise.all(change.windows.newValue.wids.map(wid => {
							return new Promise((resolve, reject) => {
								windowsAddedBySync.push({ wid: wid });
								chrome.windows.create({ type: "normal" }, window => {
									windowsAddedBySync.find(obj => obj.wid == wid).id = window.id;
									result.windows.wids.push(wid);
									result.windows[wid] = {
										wid: wid,
										id: window.id,
										tabs: []
									};
									if (change.windows.newValue[wid].tabs.length > 0) { // There are tabs to create, too
										Promise.all(change.windows.newValue[wid].tabs.map(tid => {
											tabsAddedBySync.push({ tid: tid });
											return new Promise((resolve2, reject2) => {
												chrome.tabs.create({
													windowId: window.id,
													url: change.tabs.newValue[tid].url,
													index: change.tabs.newValue[tid].pos
												}, tab => {
													tabsAddedBySync.find(obj => obj.tid == tid).id = tab.id;
													result.tabs.tids.push(tid);
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
								windows: result.windows
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
						Promise.all(result.windows.wids.map(wid => {
							let tabId = -1;
							// First, close all tabs attached to this window.
							return Promise.all(result.windows[wid].tabs.map(tid => {
								tabsRemovedBySync.push(tid);
								tabId = result.tabs[tid].id;
								result.windows[wid].tabs.splice(result.windows[wid].tabs.indexOf(tid), 1);
								result.tabs.tids.splice(result.tabs.tids.indexOf(tid), 1);
								delete result.tabs[tid];
								return new Promise((resolve, reject) => {
									chrome.tabs.remove(tabId, () => {
										resolve();
									});
								});
							})).then(() => { // All tabs attached to this window are closed.
								let windowId = -1;
								windowId = result.windows[wid].id;
								result.windows.wids.splice(result.windows.wids.indexOf(wid), 1);
								delete result.windows[wid];
								return new Promise((resolve, reject) => {
									chrome.windows.remove(windowId, () => resolve());
								});
							});
						})).then(() => {
							chrome.storage.local.set({
								windows: result.widows
							}, () => rootResolve());
						});
					}
				} else { // Window/tab created or removed.
					console.log("Window/tab created or removed");
					// First, check if there's a new window created.
					Promise.all(change.windows.newValue.wids.map(wid => {
						if (!change.windows.oldValue.wids.includes(wid)) { // New window
							console.log("A new window created");
							if (typeof result.windows == "undefined" ? true : !result.windows.wids.includes(wid)) { // Not local event
								console.log("A new window created in another device");
								return new Promise((resolve, reject) => {
									chrome.windows.create({ type: "normal" }, window => {
										result.windows.wids.push(wid);
										result.windows[wid] = {
											id: window.id,
											wid: wid,
											tabs: []
										};
										resolve();
									});
								});
							}
						}
					})).then(() => { // Then check if tab changed.
						let promises = [];
						if (typeof change.tabs != "undefined") {
							if (typeof change.tabs.newValue == "undefined") { // All tabs are gone.
								change.tabs.oldValue.tids.forEach(tid => {
									if (typeof result.tabs != "undefined") {
										if (result.tabs.tids.includes(tid)) {
											promises.push(new Promise((resolve, reject) => {
												tabsRemovedBySync.push(tid);
												let wid = result.tabs[tid].wid;
												result.windows[wid].tabs.splice(result.windows[wid].tabs.indexOf(tid), 1);
												result.tabs.tids.splice(result.tabs.tids.indexOf(tid), 1);
												delete result.tabs[tid];
												chrome.tabs.remove(tid, () => resolve());
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
									if (!result.tabs.tids.includes(tid)) { // Not local event
										console.log("Another device created fresh tabs");
										promises.push(new Promise((resolve, reject) => {
											tabsAddedBySync.push({ tid: tid });
											let wid = change.tabs.newValue[tid].wid;
											chrome.tabs.create({
												windowId: result.windows[wid].id,
												index: change.tabs.newValue[tid].pos,
												url: change.tabs.newValue[tid].url
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
										if (typeof result.tabs == "undefined" ? true : !result.tabs.tids.includes(tid)) { // Not local event
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
												chrome.tabs.create({
													windowId: result.windows[change.tabs.newValue[tid].wid].id,
													index: change.tabs.newValue[tid].pos,
													url: change.tabs.newValue[tid].url
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
												tabsRemovedBySync.push(tid);
												chrome.tabs.remove(tid, () => {
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
						return Promise.all(promises);
					}).then(() => { // Check for removed windows
						return Promise.all(change.windows.oldValue.wids.map(wid => {
							if (!change.windows.newValue.wids.includes(wid)) { // Removed window
								if (typeof result.windows == "undefined" ? false : result.windows.wids.includes(wid)) { // Not local event
									console.log("Another device removed a window");
									if (result.windows[wid].tabs.length != 0) {
										console.log('Error!! Why there\'re tabs remaining??');
									}
									return new Promise((resolve, reject) => {
										windowsRemovedBySync.push(wid);
										chrome.windows.remove(wid, () => {
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
						}, () => rootResolve());
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
chrome.storage.onChanged.addListener(syncEventHandler);
