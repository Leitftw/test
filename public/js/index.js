/*
* 	REGULAR INDEX PAGE FUNCTIONS
*/

//Toggles a category filter. Sets the internal selectedCategory variable and changes the button's class.
function toggleCategory(button) {

	//Add/remove class to button depending on the state
	categoryId = button.id;
	if (selectedCategory === categoryId) {
		button.classList.remove("toggled");
		selectedCategory = "";
	} else {
		selectedCategory = categoryId;
		button.classList.add("toggled");
	}

	//Trigger search
	performSearch();
}

function toggleFilter(button) {

	// jquerify
	button = $(button);

	//invert input's checked value
	inboxState = !(button.prop("checked"));
	button.prop("checked", inboxState);

	if (inboxState) {
		button.addClass("toggled");
	} else {
		button.removeClass("toggled");
	}

	//Redraw the table 
	performSearch();
}

// Looks at the active filters and performs a search using DataTables' API.
// (which is hooked back to the internal Search API)
function performSearch() {

	// Add the selected category to the tags column so it's picked up by the search engine 
	// This allows for the regular search bar to be used in conjunction with categories.
	arcTable.column('.tags.itd').search(selectedCategory);

	// Add the isnew filter if asked
	input = $("#inboxbtn");

	if (input.prop("checked")) {
		arcTable.column('.isnew').search("true");
	} else {
		// no fav filters
		arcTable.column('.isnew').search("");
	}

	// Add the untagged filter if asked
	input = $("#untaggedbtn");

	if (input.prop("checked")) {
		arcTable.column('.untagged').search("true");
	} else {
		// no fav filters
		arcTable.column('.untagged').search("");
	}

	arcTable.search($('#srch').val().replace(",", ""));
	arcTable.draw();

	//Re-load categories so the most recently selected/created ones appear first
	loadCategories();
}

function initSettings(version) {

	// Default to thumbnail mode
	if (localStorage.getItem("indexViewMode") === null) {
		localStorage.indexViewMode = 1;
	}

	// Default to crop landscape
	if (localStorage.getItem("cropthumbs") === null) {
		localStorage.cropthumbs = true;
	}

	// Default custom columns
	if (localStorage.getItem("customColumn1") === null) {
		localStorage.customColumn1 = "artist";
		localStorage.customColumn2 = "series";
	}
	
	// Tell user about the context menu
	if (localStorage.getItem("sawContextMenuToast") === null) {
		localStorage.sawContextMenuToast = true;

		$.toast({
			heading: `欢迎使用 LANraragi ${version}!`,
			text: "如果要对存档执行高级操作，请记住只需右键单击其名称。 祝您阅读愉快！",
			hideAfter: false,
			position: 'top-left',
			icon: 'info'
		});
	}

	//0 = List view
	//1 = Thumbnail view
	// List view is at 0 but became the non-default state later so here's some legacy weirdness 
	if (localStorage.indexViewMode == 0)
		$("#compactmode").prop("checked", true);

	if (localStorage.cropthumbs === 'true')
		$("#cropthumbs").prop("checked", true);
	updateTableHeaders();
}

function saveSettings() {
	localStorage.indexViewMode = $("#compactmode").prop("checked") ? 0 : 1;
	localStorage.cropthumbs = $("#cropthumbs").prop("checked");

	localStorage.customColumn1 = $("#customcol1").val();
	localStorage.customColumn2 = $("#customcol2").val();

	// Absolutely disgusting
	arcTable.settings()[0].aoColumns[1].sName = localStorage.customColumn1;
	arcTable.settings()[0].aoColumns[2].sName = localStorage.customColumn2;

	updateTableHeaders();
	closeOverlay();

	//Redraw the table yo
	arcTable.draw();
}

function updateTableHeaders() {

	var cc1 = localStorage.customColumn1;
	var cc2 = localStorage.customColumn2;

	$("#customcol1").val(cc1);
	$("#customcol2").val(cc2);
	$("#customheader1").children()[0].innerHTML = cc1.charAt(0).toUpperCase() + cc1.slice(1);
	$("#customheader2").children()[0].innerHTML = cc2.charAt(0).toUpperCase() + cc2.slice(1);
}

function checkVersion(currentVersionConf) {
	//Check the github API to see if an update was released. If so, flash another friendly notification inviting the user to check it out
	var githubAPI = "https://api.github.com/repos/difegue/lanraragi/releases/latest";
	var latestVersion;

	$.getJSON(githubAPI).done(function (data) {
		var expr = /(\d+)/g;
		var latestVersionArr = Array.from(data.tag_name.match(expr));
		var latestVersion = '';
		var currentVersionArr = Array.from(currentVersionConf.match(expr));
		var currentVersion = '';

		latestVersionArr.forEach(function (element, index) {
			if (index + 1 < latestVersionArr.length) {
				latestVersion = latestVersion + '' + element;
			} else {
				latestVersion = latestVersion + '.' + element;
			}
		});
		currentVersionArr.forEach(function (element, index) {
			if (index + 1 < currentVersionArr.length) {
				currentVersion = currentVersion + '' + element;
			} else {
				currentVersion = currentVersion + '.' + element;
			}
		});

		if (latestVersion > currentVersion) {

			$.toast({
				heading: '新的 LANraragi (' + data.tag_name + ') 可用 !',
				text: '<a href="' + data.html_url + '">点击此处查看.</a>',
				hideAfter: false,
				position: 'top-left',
				icon: 'info'
			});

		}
	});
}

function handleContextMenu(option, id) {

	if (option.startsWith("category-")) {
		var catId = option.replace("category-", "");
		addArchiveToCategory(id, catId);
		return;
	}

	switch (option) {
		case "edit":
			window.open("./edit?id=" + id);
			break;
		case "delete":
			if (confirm('你确定删除该档案吗?'))
				deleteArchive(id);
			break;
		case "read":
			window.open(`./reader?id=${id}`);
			break;
		case "download":
			window.open(`./api/archives/${id}/download`);
			break;
		default:
			break;
	}
}

// Format tag objects from the API into a format awesomplete likes.
function fullTag(tag) {
	label = tag.text;
	if (tag.namespace !== "")
		label = tag.namespace + ":" + tag.text;

	return { label: label, value: tag.weight };
}

function loadTagSuggestions() {
	// Query the tag cloud API to get the most used tags.
	$.get("/api/database/stats")
		.done(function (data) {
			// Only use tags with weight >1 
			taglist = data.reduce(function (res, tag) {
				if (tag.weight > 1)
					res.push(tag);
				return res;
			}, []);

			new Awesomplete('#srch', {
				list: taglist,
				data: fullTag,
				// Sort by weight
				sort: function (a, b) { return b.value - a.value; },
				filter: function (text, input) {
					return Awesomplete.FILTER_CONTAINS(text, input.match(/[^, -]*$/)[0]);
				},
				item: function (text, input) {
					return Awesomplete.ITEM(text, input.match(/[^, -]*$/)[0]);
				},
				replace: function (text) {
					var before = this.input.value.match(/^.*(,|-)\s*-*|/)[0];
					this.input.value = before + text + ", ";
				}
			});

		}).fail(data => showErrorToast("无法加载标签建议", data.error));
}

function loadCategories() {
	// Query the category API to get the most used tags.
	$.get("/api/categories")
		.done(function (data) {

			// Sort by LastUsed + pinned
			// Pinned categories are shown at the beginning
			data.sort((a, b) => parseFloat(b.last_used) - parseFloat(a.last_used));
			data.sort((a, b) => parseFloat(b.pinned) - parseFloat(a.pinned));
			var html = "";

			var iteration = (data.length > 10 ? 10 : data.length);

			for (var i = 0; i < iteration; i++) {
				category = data[i];
				const pinned = category.pinned === "1";

				catName = (pinned ? "📌" : "") + category.name;
				catName = encode(catName);

				div = `<div style='display:inline-block'>
						<input class='favtag-btn ${((category.id == selectedCategory) ? "toggled" : "")}' 
							   type='button' id='${category.id}' value='${catName}' 
							   onclick='toggleCategory(this)' title='单击此处显示此类别中包含的档案.'/>
					   </div>`;

				html += div;
			}

			//If more than 10 categories, the rest goes into a dropdown
			if (data.length > 10) {
				html += `<select id="catdropdown" class="favtag-btn">
							<option selected disabled>...</option>`;

				for (var i = 10; i < data.length; i++) {

					category = data[i];
					catName = encode(category.name);

					html += `<option id='${category.id}'>
								${catName}
							 </option>`;

				}
				html += "</select>";
			}

			$("#category-container").html(html);

			// Add a listener on dropdown selection
			$("#catdropdown").on("change", () => toggleCategory($("#catdropdown")[0].selectedOptions[0]));

		}).fail(data => showErrorToast("无法加载分类", data.error));
}

function encode(r) {
	if (r === undefined)
		return r;
	if (Array.isArray(r))
		return r[0].replace(/[\x26\x0A\<>'"]/g, function (r) { return "&#" + r.charCodeAt(0) + ";" });
	else
		return r.replace(/[\x26\x0A\<>'"]/g, function (r) { return "&#" + r.charCodeAt(0) + ";" })
}

function openSettings() {
	$('#overlay-shade').fadeTo(150, 0.6, function () {
		$('#settingsOverlay').css('display', 'block');
	});
}

function closeOverlay() {
	$('#overlay-shade').fadeOut(300);
	$('.base-overlay').css('display', 'none');
}
