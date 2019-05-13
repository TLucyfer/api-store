// Phantombuster configuration {
"phantombuster command: nodejs"
"phantombuster package: 5"
"phantombuster dependencies: lib-StoreUtilities.js, lib-Facebook.js"

const { parse } = require("url")

const Buster = require("phantombuster")
const buster = new Buster()

const Nick = require("nickjs")
const nick = new Nick({
	loadImages: false,
	printPageErrors: false,
	printResourceErrors: false,
	printNavigation: false,
	printAborts: false,
	debug: false,
	timeout: 30000
})
const StoreUtilities = require("./lib-StoreUtilities")
const utils = new StoreUtilities(nick, buster)

const Facebook = require("./lib-Facebook")
const facebook = new Facebook(nick, buster, utils)
let interceptedUrl
let interceptedHeaders
let alreadyScraped = 0
let agentObject
let ajaxUrl
let stillMoreToScrape
let lastQuery
let error
let lockedByFacebook
const cheerio = require("cheerio")
const { URL } = require("url")


/* global $ */

const ajaxCall = (arg, cb) => {
	try {
		$.ajax({
			url: arg.url,
			type: "GET",
			headers: arg.headers
		})
		.done(res => {
			cb(null, res)
		})
		.fail(err => {
			cb(err.toString())
		})
	} catch (err) {
		cb(err)
	}
}

// Checks if a url is a facebook group url
const isFacebookGroupUrl = (url) => {
	try {
		let urlObject = parse(url.toLowerCase())
		if (urlObject.pathname.startsWith("facebook")) {
			urlObject = parse("https://www." + url)
		}
		if (urlObject.pathname.startsWith("www.facebook")) {
			urlObject = parse("https://" + url)
		}
		if (urlObject && urlObject.hostname.includes("facebook.com") && urlObject.pathname.startsWith("/groups")) {
			return true
		}
	} catch (err) {
		//
	}
	return false
}

// Forces the url to the group homepage
const cleanGroupUrl = (url) => {
	const urlObject = parse(url)
	let cleanName = urlObject.pathname.slice(8)
	if (cleanName.includes("/")) {
		cleanName = cleanName.slice(0,cleanName.indexOf("/"))
	}
	return "https://www.facebook.com/groups/" + cleanName + "/"
}

const interceptFacebookApiCalls = e => {
	if (e.response.url.indexOf("?gid=") > -1 && e.response.status === 200) {
		interceptedUrl = e.response.url
	}
}

const onHttpRequest = (e) => {
	if (e.request.url.indexOf("?gid=") > -1) {
		interceptedHeaders = e.request.headers
	}
}

// Getting the group name and member count
const firstScrape = (arg, callback) => {
	let groupName
	if (document.querySelector("#seo_h1_tag a")) {
		groupName = document.querySelector("#seo_h1_tag a").textContent
	}

	let membersCount
	if (document.querySelector("#groupsMemberBrowser div div div span")) {
		membersCount = document.querySelector("#groupsMemberBrowser div div div span").textContent
		membersCount = parseInt(membersCount.replace(/[^\d]/g, ""), 10)
	}
	const data = {groupName, membersCount}

	callback(null, data)
}

const scrapeFirstMembers = (arg, callback) => {
	let groupName
	if (document.querySelector("#seo_h1_tag a")) {
		groupName = document.querySelector("#seo_h1_tag a").textContent
	}	const results = document.querySelectorAll(".uiList.clearfix > div")
	const data = []
	for (const result of results) {
		if (result.querySelector("a")) {
			const url = result.querySelector("a").href
			// a few profiles don't have a name and are just www.facebook.com/profile.php?id=IDNUMBER&fref..
			let profileUrl = (url.indexOf("profile.php?") > -1) ? url.slice(0, url.indexOf("&")) : url.slice(0, url.indexOf("?"))
			let newData = { profileUrl }
			try {
				let id = result.id
				if (id.includes("recently_joined")) {
					newData.uid = id.slice(16)
				}
			} catch (err) {
				//
			}
			if (result.querySelector("img")) {
				newData.profilePicture = result.querySelector("img").src
				newData.name = result.querySelector("img").getAttribute("aria-label")
				const nameArray = newData.name.split(" ")
				newData.firstName = nameArray.shift()
				const lastName = nameArray.join(" ")
				if (lastName) {
					newData.lastName = lastName
				}
			}
			newData.groupName = groupName
			newData.groupUrl = arg.groupUrl
			if (result.querySelector(".timestampContent")) {
				newData.memberSince = result.querySelector(".timestampContent").textContent
			} else if (result.querySelector(".uiProfileBlockContent a").parentElement.nextSibling) { // sometimes they're not in a .timestampContent class
				newData.memberSince = result.querySelector(".uiProfileBlockContent a").parentElement.nextSibling.textContent
			}
			if (result.querySelector(".uiProfileBlockContent > div > div:last-of-type > div:last-of-type")) {
				newData.additionalData = result.querySelector(".uiProfileBlockContent > div > div:last-of-type > div:last-of-type").textContent
			}
			newData.timestamp = (new Date()).toISOString()
			data.push(newData)
		}
	}
	callback(null, data)
}

const getFirstResult = async (tab, url) => {
	const selectors = ["#groupsMemberBrowser"]
	await tab.open(url + "members")
	try {
		await tab.waitUntilVisible(selectors, 7500, "or")
	} catch (err) {
		// No need to go any further, if the API can't determine if there are (or not) results in the opened page
		return null
	}
	const result = await tab.evaluate(firstScrape)
	return result
}

const extractProfiles = (htmlContent, groupUrl, groupName) => {
	let profileList = htmlContent.split("GroupProfileGridItem")
	profileList.shift()
	const result = []
	for (const profile of profileList) {
		const data = {}
		const chr = cheerio.load(profile)
		const url = chr("a").attr("href")
		if (url) {
			const profileUrl = (url.indexOf("profile.php?") > -1) ? url.slice(0, url.indexOf("&")) : url.slice(0, url.indexOf("?"))
			data.profileUrl = profileUrl
		}
		try {
			const uid = profile.slice(profile.indexOf("GroupMember") + 12).slice(0, profile.slice(profile.indexOf("GroupMember") + 12).indexOf("\""))
			if (uid) {
				data.uid = uid
			}
		} catch (err) {
			//
		}
		const name = chr("img").attr("aria-label")
		data.name = name
		const extractedNames = facebook.getFirstAndLastName(name)
		data.firstName = extractedNames.firstName
		if (extractedNames.lastName) {
			data.lastName = extractedNames.lastName
		}
		const profilePicture = chr("img").attr("src")
		data.profilePicture = profilePicture
		const memberSince = chr(".timestamp").attr("title")
		if (memberSince) {
			data.memberSince = memberSince
		} else {
			let splitByATag = profile.split("<a")
			splitByATag = "<a" + splitByATag[splitByATag.length - 1]
			splitByATag = cheerio.load(splitByATag)
			if (splitByATag("a").next().text()) {
				data.memberSince = splitByATag("a").next().text()
			}
		}
		let additionalData = chr(".timestampContent").parents().next().html()
		const additionalDataText = chr(".timestampContent").parents().next().text()
		if (additionalData && additionalDataText && additionalData.length > additionalDataText.length) {
			additionalData = additionalDataText
		}
		if (additionalData) {
			data.additionalData = additionalData
		}
		data.groupUrl = groupUrl
		data.groupName = groupName
		data.timestamp = (new Date()).toISOString()

		result.push(data)
	}
	const chrHtml = cheerio.load(htmlContent)
	const cursorUrl = chrHtml(".uiMorePager a").attr("href")
	return [ result, cursorUrl ]
}

const getJsonUrl = async (tab, url) => {
	await tab.open(url)
	await tab.wait(2000)
	await tab.scrollToBottom()
	await tab.wait(3000)
}

const getJsonResponse = async (tab, url) => {
	await tab.inject("../injectables/jquery-3.0.0.min.js")
	let jsonResponse = await tab.evaluate(ajaxCall, {url, headers: interceptedHeaders})
	jsonResponse = JSON.parse(jsonResponse.slice(9))
	jsonResponse = jsonResponse.domops[0][3].__html
	return jsonResponse
}

const forgeNewUrl = (cursorUrl, scrapeCount, membersToScrape) => {
	cursorUrl = new URL("https://facebook.com" + cursorUrl)
	const cursor = cursorUrl.searchParams.get("cursor")
	let nextUrl = new URL(interceptedUrl)
	nextUrl.searchParams.set("cursor", cursor)
	nextUrl = changeCursorLimit(nextUrl.href, scrapeCount, membersToScrape)
	return nextUrl
}

const changeCursorLimit = (url, scrapeCount, membersToScrape) => {
	const urlObject = new URL(url)
	let numberToScrape = 500
	if (scrapeCount + 500 > membersToScrape) {
		numberToScrape = membersToScrape - scrapeCount
	}
	urlObject.searchParams.set("limit", numberToScrape)
	return urlObject.href
}

const scrapeMembers = async (tab, groupUrl, groupName, ajaxUrl, membersToScrape, numberAlreadyScraped) => {
	let jsonResponse
	try {
		jsonResponse = await getJsonResponse(tab, ajaxUrl)
		await tab.inject("../injectables/jquery-3.0.0.min.js")
	} catch (err) {
		try {
			jsonResponse = await getJsonResponse(tab, ajaxUrl)
		} catch (err) {
			stillMoreToScrape = true
			return [ [], ajaxUrl, false, true ]
		}
	}
	let cursorUrl
	let result
	[ result, cursorUrl ] = extractProfiles(jsonResponse, groupUrl, groupName)
	ajaxUrl = forgeNewUrl(cursorUrl, numberAlreadyScraped + result.length, membersToScrape)
	let keepScraping = false
	if (cursorUrl) { keepScraping = true }
	const scrapeMembersObject = { result, ajaxUrl, keepScraping, error: false}
	return scrapeMembersObject
}

const getFacebookMembers = async (tab, groupUrl, membersPerAccount, membersPerLaunch, resuming) => {
	let result = []
	let totalProfileCount
	let firstResults
	try {
		firstResults = await getFirstResult(tab, groupUrl)
		if (firstResults) {
			utils.log(`Group ${firstResults.groupName} contains about ${firstResults.membersCount} members.`, "loading")
		} else if (await facebook.checkLock(tab)) {
			utils.log("Facebook is asking for an account verification.", "warning")
			lockedByFacebook = true
			return []
		} else {
			utils.log(`Could not get data from ${groupUrl}, it may be a closed group you're not part of.`, "error")
			return [{ groupUrl, error: "Closed group", timestamp: (new Date()).toISOString() }]
		}
	} catch (err) {
		utils.log(`Could not connect to ${groupUrl}`, "error")
		return []
	}
	if (resuming) {
		totalProfileCount = alreadyScraped
	} else {
		await tab.open(groupUrl + "recently_joined")
		await tab.waitUntilVisible(".uiList.clearfix")
		const timeInit = new Date()
		do {
			await tab.scrollToBottom()
			await tab.wait(3000)
		} while (!interceptedUrl && new Date() - timeInit < 10000)
		result = await tab.evaluate(scrapeFirstMembers, { groupUrl })
		totalProfileCount = result.length
		ajaxUrl = interceptedUrl
	}
	let scrapeCount = result.length
	let membersToScrape
	if (membersPerLaunch && membersPerAccount) {
		membersToScrape = Math.min(membersPerAccount, membersPerLaunch)
	} else {
		membersToScrape = membersPerAccount || membersPerLaunch || firstResults.membersCount
		}
	result = result.slice(0, membersToScrape)
	lastQuery = groupUrl
	if (!resuming) {
		try {
			if (!ajaxUrl) {
				await tab.wait(1000)
			}
			await tab.inject("../injectables/jquery-3.0.0.min.js")
			try {
				if (!interceptedUrl) { // if we still don't have an ajax URL
					await tab.scrollToBottom()
					await tab.wait(5000)
				}
				let cursorUrl
				[ , cursorUrl ] = extractProfiles(await getJsonResponse(tab, interceptedUrl), groupUrl, firstResults.groupName)
				ajaxUrl = forgeNewUrl(cursorUrl, result.length, membersToScrape)
			} catch (err) {
				//
			}
		} catch (err) {
			//
		}
	} else {
		ajaxUrl = changeCursorLimit(agentObject.nextUrl, 0, membersToScrape)
	}
	let keepScraping = true
	let res
	do {
		const timeLeft = await utils.checkTimeLeft()
		if (!timeLeft.timeLeft) {
			utils.log(`Scraping stopped: ${timeLeft.message}`, "warning")
			stillMoreToScrape = true
			break
		}
		try {
			const scrapeMembersObject = await scrapeMembers(tab, groupUrl, firstResults.groupName, ajaxUrl, membersToScrape, result.length)
			res = scrapeMembersObject.result
			ajaxUrl = scrapeMembersObject.ajaxUrl
			keepScraping = scrapeMembersObject.keepScraping
			error = scrapeMembersObject.error
		} catch (err) {
			if (resuming) {
				utils.log(`${err}, restarting followers scraping`, "warning")
				resuming = false
				await getJsonUrl(tab, groupUrl)
				ajaxUrl = interceptedUrl
				totalProfileCount = 0
				continue
			}
		}
		if (res) {
			result = result.concat(res)
			const resLength = res.length
			totalProfileCount += resLength
			scrapeCount += resLength
		}
		utils.log(`Got ${totalProfileCount} members.`, "info")
		buster.progressHint(scrapeCount / membersToScrape, `Loading members... ${scrapeCount}/${membersToScrape}`)
		if (!keepScraping && !error) { utils.log(`All members of ${groupUrl} scraped.`, "done") }
		if (scrapeCount >= membersToScrape) {
			stillMoreToScrape = true
			break
		}
	} while (keepScraping)
	if (error) {
		utils.log("Connecting error, interruption...", "warning")
		stillMoreToScrape = true
	}
	return result
}

const checkIfPage = async (tab, url) => {
	try {
		await tab.open(url)
		await tab.waitUntilVisible("div[data-key=\"tab_ads\"]")
		return true
	} catch (err) {
		//
	}
	return false
}

// Main function to launch all the others in the good order and handle some errors
nick.newTab().then(async (tab) => {
	let { sessionCookieCUser, sessionCookieXs, groupsArray, groupsUrl, columnName, numberMaxOfMembers, membersPerLaunch, csvName, numberOfLinesPerLaunch } = utils.validateArguments()
	await facebook.login(tab, sessionCookieCUser, sessionCookieXs)
	if (!csvName) { csvName = "result" }
	if (!numberMaxOfMembers) { numberMaxOfMembers = false }
	try {
		agentObject = await buster.getAgentObject()
	} catch (err) {
		utils.log("Could not access agent Object.", "warning")
	}
	let singleGroup
	if (groupsUrl) {
		let isAFacebookGroupUrl = isFacebookGroupUrl(groupsUrl)
		if (isAFacebookGroupUrl) { // Facebook Group URL
			groupsArray = [ cleanGroupUrl(utils.adjustUrl(groupsUrl, "facebook")) ] // cleaning a single group entry
			singleGroup = true
		} else {
			if (groupsUrl.includes("facebook.com/") && await checkIfPage(tab, groupsUrl)) {
				utils.log(`${groupsUrl} isn't a Group URL, it's a Facebook Page URL... Please use the Facebook Page Likers API instead.`, "error")
				nick.exit(utils.ERROR_CODES.BAD_INPUT)
			}
			// Link not from Facebook, trying to get CSV
			groupsArray = await utils.getDataFromCsv2(groupsUrl, columnName)
		}
	} else if (typeof groupsArray === "string") {
		groupsArray = [groupsArray]
		singleGroup = true
	}
	let result = await utils.getDb(csvName + ".csv")
	const initialResultLength = result.length
	if (initialResultLength) {
		alreadyScraped = result.filter(el => el.groupUrl === agentObject.lastQuery).length
	}
	if (!singleGroup) {
		groupsArray = groupsArray.filter(str => str) // removing empty lines
		if (groupsArray.length === 0) {
			utils.log("Spreadsheet is empty!", "error")
			nick.exit(1)
		}
		if (groupsArray.length !== 1) { membersPerLaunch = false }
		for (let i = 0; i < groupsArray.length; i++) { // cleaning all group entries
			groupsArray[i] = utils.adjustUrl(groupsArray[i], "facebook")
			const isGroupUrl = isFacebookGroupUrl(groupsArray[i])
			if (isGroupUrl) { groupsArray[i] = cleanGroupUrl(groupsArray[i]) }
		}
		const lastUrl = groupsArray[groupsArray.length - 1]
		groupsArray = groupsArray.filter(str => utils.checkDb(str, result, "groupUrl"))
		if (numberOfLinesPerLaunch) {
			groupsArray = groupsArray.slice(0, numberOfLinesPerLaunch)
		}
		if (groupsArray.length < 1) { groupsArray = [lastUrl] } // if every group's already been scraped, we're scraping the last one
	}
	utils.log(`Groups to scrape: ${JSON.stringify(groupsArray, null, 2)}`, "done")
	tab.driver.client.on("Network.responseReceived", interceptFacebookApiCalls)
	tab.driver.client.on("Network.requestWillBeSent", onHttpRequest)
	let currentResult = []
	for (let url of groupsArray) {
		if (isFacebookGroupUrl(url)) { // Facebook Group URL
			let resuming = false
			if (alreadyScraped && agentObject && url === agentObject.lastQuery) {
				utils.log(`Resuming scraping for ${url}...`, "info")
				resuming = true
			} else {
				utils.log(`Getting data from ${url}...`, "loading")
			}
			try {
				currentResult = currentResult.concat(await getFacebookMembers(tab, url, numberMaxOfMembers, membersPerLaunch, resuming))
			} catch (err) {
				utils.log(`Could not connect to ${url}  ${err}`, "error")
			}
		} else {
			const isPaged = await checkIfPage(tab, url)
			utils.log(`${url} doesn't constitute a Facebook Group URL${isPaged ? ", it's a Page URL" : ""}... skipping entry`, "warning")
			currentResult.push({ groupUrl: url, error: "Not a Group URL", timestamp: (new Date()).toISOString() })
		}
		if (lockedByFacebook) {
			break
		}
		const timeLeft = await utils.checkTimeLeft()
		if (!timeLeft.timeLeft) {
			utils.log(`Scraping stopped: ${timeLeft.message}`, "warning")
			stillMoreToScrape = true
			break
		}
	}

	tab.driver.client.removeListener("Network.responseReceived", interceptFacebookApiCalls)
	tab.driver.client.removeListener("Network.requestWillBeSent", onHttpRequest)

	if (currentResult.length) {
		result = result.concat(currentResult)
		await utils.saveFlatResults(currentResult, result, csvName)
		if (agentObject) {
			if (stillMoreToScrape && ajaxUrl) {
				agentObject.nextUrl = ajaxUrl
				agentObject.lastQuery = lastQuery
			} else {
				delete agentObject.nextUrl
				delete agentObject.lastQuery
			}
			await buster.setAgentObject(agentObject)
		}
	}
	utils.log("Job is done!", "done")
	nick.exit(0)
})
.catch((err) => {
	utils.log(err, "error")
	nick.exit(1)
})
