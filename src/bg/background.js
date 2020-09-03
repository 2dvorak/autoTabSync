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
		console.log(count);
	});
}

chrome.tabs.onCreated.addListener(logCurrentWindowCount);
