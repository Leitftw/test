//Scripting for Generic API calls.

// Show a generic error toast with a given header and message.
function showErrorToast(header, error) {
	$.toast({
		showHideTransition: 'slide',
		position: 'top-left',
		loader: false,
		heading: header,
		text: error,
		hideAfter: false,
		icon: 'error'
	});
}

//Call that shows a popup to the user on success/failure. Returns the promise so you can add final callbacks if needed.
// Endpoint: URL endpoint
// Method: GET/PUT/DELETE/POST
// successMessage: Message written in the toast if request succeeded (success = 1)
// errorMessage: Header of the error message if request fails (success = 0)
// successCallback: Func called if request succeeded
function genericAPICall(endpoint, method, successMessage, errorMessage, successCallback) {

	return fetch(endpoint, { method: method })
		.then(response => response.ok ? response.json() : { success: 0, error: "回應不正確" })
		.then((data) => {

			if (data.success) {
				if (successMessage !== null)
					$.toast({
						showHideTransition: 'slide',
						position: 'top-left',
						loader: false,
						heading: successMessage,
						icon: 'success'
					});

				if (successCallback !== null)
					successCallback(data);

			} else {
				throw new Error(data.error);
			}
		})
		.catch(error => showErrorToast(errorMessage, error));
}

// Check the status of a Minion job until it's completed.
// Execute a callback on successful job completion.
function checkJobStatus(jobId, callback, failureCallback) {
	fetch(`api/minion/${jobId}`, { method: "GET" })
		.then(response => response.ok ? response.json() : { success: 0, error: "回應不正確" })
		.then((data) => {

			if (data.error)
				throw new Error(data.error);

			if (data.state === "failed") {
				throw new Error(data.result);
			}

			if (data.state !== "finished") {
				// Wait and retry, job isn't done yet
				setTimeout(function () {
					checkJobStatus(jobId, callback);
				}, 1000);
			} else {
				// Update UI with info
				callback(data);
			}
		})
		.catch(error => { showErrorToast("檢查 Minion 工作狀態時出錯", error); failureCallback(error) });
}

//saveFormData()
//POSTs the data of the specified form to the page.
//This is used for Edit, Config and Plugins.
// Returns the promise object so you can chain more callbacks.
function saveFormData(formSelector) {

	var postData = new FormData($(formSelector)[0]);

	return fetch(window.location.href, { method: "POST", body: postData })
		.then(response => response.ok ? response.json() : { success: 0, error: "回應不正確" })
		.then((data) => {
			if (data.success) {
				$.toast({
					showHideTransition: 'slide',
					position: 'top-left',
					loader: false,
					heading: '保存成功！',
					icon: 'success'
				})
			} else {
				throw new Error(data.message);
			}
		})
		.catch(error => showErrorToast("保存出錯", error));
}

let isScriptRunning = false;
function triggerScript(namespace) {

	const scriptArg = $("#" + namespace + "_ARG").val();

	if (isScriptRunning) {
		showErrorToast("一個腳本已在運行。", "請等待腳本終止。");
		return;
	}

	isScriptRunning = true;
	$(".script-running").show();
	$(".stdbtn").hide();

	// Save data before triggering script
	saveFormData('#editPluginForm')
		.then(genericAPICall(`../api/plugins/use?plugin=${namespace}&arg=${scriptArg}`, "POST", null, "執行腳本時出錯 :",
			function (r) {
				$.toast({
					showHideTransition: 'slide',
					position: 'top-left',
					loader: false,
					heading: "Script result",
					text: "<pre>" + JSON.stringify(r.data, null, 4) + "</pre>",
					hideAfter: false,
					icon: 'info'
				});
			}))
		.then(() => {
			isScriptRunning = false;
			$(".script-running").hide();
			$(".stdbtn").show();
		})
		.catch(() => {
			isScriptRunning = false;
			$(".script-running").hide();
			$(".stdbtn").show();
		});
}

function cleanTempFldr() {
	genericAPICall("api/tempfolder", "DELETE", "臨時文件夾已清理!", "清理臨時文件夾時出錯 :",
		function (data) {
			$("#tempsize").html(data.newsize);
		});
}

function invalidateCache() {
	genericAPICall("api/search/cache", "DELETE", "丟棄搜索快取!", "刪除快取時出錯！ 請檢查日誌。", null);
}

function clearNew(id) {
	genericAPICall(`api/archives/${id}/isnew`, "DELETE", null, "清除新標籤時出錯！請檢查日誌。", null);
}

function clearAllNew() {
	genericAPICall("api/database/isnew", "DELETE", "所有檔案不再是新的!", "清除標籤時出錯！ 請檢查日誌。", null);
}

function dropDatabase() {
	if (confirm('危險！ 你確定要這麼做嗎?')) {
		genericAPICall("api/database/drop", "POST", "Sayonara! 重定向...", "重設資料庫時出錯？ 請檢查日誌。",
			function (data) {
				setTimeout("location.href = './';", 1500);
			});
	}
}

function cleanDatabase() {
	genericAPICall("api/database/clean", "POST", null, "清理資料庫時出錯！ 請檢查日誌。",
		function (data) {
			$.toast({
				showHideTransition: 'slide',
				position: 'top-left',
				loader: false,
				heading: "成功清理資料庫並刪除 " + data.deleted + " 條!",
				icon: 'success'
			});

			if (data.unlinked > 0) {
				$.toast({
					showHideTransition: 'slide',
					position: 'top-left',
					loader: false,
					heading: data.unlinked + " 其他條目已從資料庫取消連結，將在下次清理時刪除！ <br>如果某些文件從存檔索引中消失，請立即進行備份。",
					hideAfter: false,
					icon: 'warning'
				});
			}
		});
}

function rebootShinobu() {
	$("#restart-button").prop("disabled", true);
	genericAPICall("api/shinobu/restart", "POST", "後台服務重啟!", "重啟後台服務失敗:",
		function (data) {
			$("#restart-button").prop("disabled", false);
			shinobuStatus();
		});
}

//Update the status of the background worker.
function shinobuStatus() {

	genericAPICall("api/shinobu", "GET", null, "獲取Shinobu狀態失敗:",
		function (data) {
			if (data.is_alive) {
				$("#shinobu-ok").show();
				$("#shinobu-ko").hide();
			} else {
				$("#shinobu-ko").show();
				$("#shinobu-ok").hide();
			}
			$("#pid").html(data.pid);

		});
}

//Adds an archive to a category. Basic implementation to use everywhere.
function addArchiveToCategory(arcId, catId) {
	genericAPICall(`/api/categories/${catId}/${arcId}`, 'PUT', `Added ${arcId} to Category ${catId}!`, "添加/移除檔案到分類失敗", null);
}

//deleteArchive(id)
//Sends a DELETE request for that archive ID, deleting the Redis key and attempting to delete the archive file.
function deleteArchive(arcId) {

	fetch("edit?id=" + arcId, { method: "DELETE" })
		.then(response => response.ok ? response.json() : { success: 0, error: "回應不正確" })
		.then((data) => {

			if (data.success == "0") {
				$.toast({
					showHideTransition: 'slide',
					position: 'top-left',
					loader: false,
					heading: "無法刪除存檔文件。 <br> (也許它已經被事先刪除了?)",
					text: '存檔元數據已正確刪除。 <br> 請先手動刪除文件，然後再返回“資料庫”。',
					hideAfter: false,
					icon: 'warning'
				});
				$(".stdbtn").hide();
				$("#goback").show();
			}
			else {
				$.toast({
					showHideTransition: 'slide',
					position: 'top-left',
					loader: false,
					heading: '存檔已成功刪除。重定向 ...',
					text: 'File name : ' + data.success,
					icon: 'success'
				});
				setTimeout("location.href = './';", 1500);
			}
		})
		.catch(error => showErrorToast("刪除檔案時出錯", error));

}
