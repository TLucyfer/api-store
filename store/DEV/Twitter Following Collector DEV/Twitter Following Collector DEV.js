// Phantombuster configuration {
"phantombuster command: nodejs"
"phantombuster package: 5"
"phantombuster dependencies: lib-StoreUtilities-DEV.js, lib-Twitter.js"

const Buster = require("phantombuster")
const buster = new Buster()

const url = require("url")
const cheerio = require("cheerio")

const Nick = require("nickjs")
const nick = new Nick({
	loadImages: true,
	userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.12; rv:54.0) Gecko/20100101 Firefox/54.0",
	printPageErrors: false,
	printResourceErrors: false,
	printNavigation: false,
	printAborts: false,
	debug: false,
	timeout: 30000
})

const StoreUtilities = require("./lib-StoreUtilities-DEV")
const utils = new StoreUtilities(nick, buster)
const Twitter = require("./lib-Twitter")
const twitter = new Twitter(nick, buster, utils)
let initDate
/* global $ */

// }
const gl = {}
let interceptedUrl
let agentObject
let interrupted
let rateLimited
let lastSavedQuery
let twitterUrl
let isProtected
let fullScrape = false
let alreadyScraped


const ajaxCall = (arg, cb) => {
	cb(null, $.get(arg.url, arg.headers))
}

const getUrlsToScrape = (data, numberofProfilesperLaunch) => {
	data = data.filter((item, pos) => data.indexOf(item) === pos)
	const maxLength = data.length
	if (maxLength === 0) {
		utils.log("Input spreadsheet is empty OR we already scraped all the profiles from this spreadsheet.", "warning")
		nick.exit()
	}
	return data.slice(0, Math.min(numberofProfilesperLaunch, maxLength)) // return the first elements
}

// Checks if a url is already in the csv
const checkDb = (str, db) => {
	for (const line of db) {
		if (str === line.query && (line.query !== lastSavedQuery || line.error)) {
			return false
		}
	}
	return true
}

// Removes any duplicate profile
/* eslint-disable-next-line no-unused-vars */
const removeDuplicatesSelf = (arr) => {
	let resultArray = []
	console.log("arr.length", arr.length)
	for (let i = 0; i < arr.length ; i++) {
		if (!resultArray.find(el => el.screenName === arr[i].screenName && el.query === arr[i].query)) {
			resultArray.push(arr[i])
		}
	}
	console.log("resultArray.length", resultArray.length)
	return resultArray
}

const interceptTwitterApiCalls = e => {
	if (e.response.url.indexOf("users?include_available") > -1 && e.response.status === 200) {
		interceptedUrl = e.response.url
		gl.headers = e.response.headers
	}
	if (e.response.url.indexOf("media_timeline") > -1 && e.response.status === 200) {
		gl.headers = e.response.headers
	}
}

const isUrl = str => url.parse(str).hostname !== null

const isTwitter = str => url.parse(str).hostname === "twitter.com"

const removeNonPrintableChars = str => str.replace(/[^a-zA-Z0-9_@]+/g, "").trim()

const scrapeFollowingCount = (arg, callback) => {
	let followersCount = 0
	if (document.querySelector("ul.ProfileNav-list li.ProfileNav-item--following span.ProfileNav-value")) {
		followersCount = document.querySelector("ul.ProfileNav-list li.ProfileNav-item--following span.ProfileNav-value").getAttribute("data-count")
	} else if (document.querySelector("div.ProfileCardStats li > a[data-element-term=following_stats] span.ProfileCardStats-statValue")) {
		followersCount = document.querySelector("div.ProfileCardStats li > a[data-element-term=following_stats] span.ProfileCardStats-statValue").getAttribute("data-count")
	}
	callback(null, followersCount)
}


const scrapeFirstFollowing = async (tab, profileUrl) => {
	const selector = await tab.waitUntilVisible(["div.GridTimeline-items", ".ProtectedTimeline"], 5000, "or")
	if (selector === ".ProtectedTimeline") {
		isProtected = true
		return []
	}
	let minPosition
	try {
		minPosition = await tab.evaluate((arg, cb) => cb(null, document.querySelector(".GridTimeline-items").getAttribute("data-min-position")))
	} catch (err) {
		//
	}
	let res
	try {
		const usl = `${profileUrl}/following/users?min_position=${minPosition}`
		res = JSON.parse(await tab.evaluate(ajaxCall, {url: usl}))
	} catch (err) {
		rateLimited = true
		interrupted = true
		return []
	}

	return extractProfiles(res.items_html, profileUrl)
}
const scrapeFollowing = async (tab, profileUrl, twitterUrl, keepScraping) => {
	let response
	try {
		response = JSON.parse(await tab.evaluate(ajaxCall, {url: twitterUrl}))
	} catch (err) {
		rateLimited = true
		interrupted = true
		return [ [], twitterUrl, false ]
	}
	const newPosition = response.min_position
	keepScraping = response.has_more_items

	if (keepScraping && (typeof newPosition === "undefined" || newPosition === "0")) { // if there's an error with getting the position we're starting the scraping over for this profile
		throw "Error getting the scraping position"
	}
	twitterUrl = `${profileUrl}/following/users?max_position=${newPosition}`
	return [ extractProfiles(response.items_html, profileUrl), twitterUrl, keepScraping ]
}

const getJsonUrl = async (tab) => {
	const selector = await tab.waitUntilVisible([".GridTimeline" , ".ProtectedTimeline"], 5000, "or")
	if (selector === ".ProtectedTimeline") { isProtected = true }
	await tab.scrollToBottom()
	await tab.wait(1000)
}

const getTwitterFollowing = async (tab, twitterHandle, followersPerAccount, resuming) => {
	// the regex should handle @xxx
	if (twitterHandle.match(/twitter\.com\/(@?[A-z0-9_]+)/)) {
		twitterHandle = twitterHandle.match(/twitter\.com\/(@?[A-z0-9_]+)/)[1]
		// removing non printables characters from the extracted handle
		twitterHandle = removeNonPrintableChars(twitterHandle)
	}
	let profileCount = 0
	const profileUrl = `https://twitter.com/${twitterHandle}`
	await tab.open(profileUrl + "/following")
	let followingCount
	let result = []
	try {
		try {
			await tab.waitUntilVisible(["ul.ProfileNav-list", "div.ProfileCardStats"], 5000, "or")
		} catch (err) {
			//
		}
		followingCount = await tab.evaluate(scrapeFollowingCount)
		utils.log(`${twitterHandle} follows ${followingCount} profiles.`, "done")
	} catch (err) {
		//
	}
	if (followingCount) {
		let numberMaxOfFollowers = followersPerAccount || followingCount
		if (!resuming) {
			try {
				result = await scrapeFirstFollowing(tab, profileUrl, followersPerAccount)
			} catch (err) {
				//
			}
		}
		if (!isProtected && (resuming || !followersPerAccount || result.length < followersPerAccount)) {
			if (!resuming) {
				await getJsonUrl(tab)
			} else {
				interceptedUrl = agentObject.nextUrl
			}
			if (!isProtected) {
				twitterUrl = interceptedUrl
				let keepScraping = true
				let res
				let displayResult = 0
				do {
					let timeLeft
					if (profileCount > 45000) {
						timeLeft = await utils.checkTimeLeft(2)
					} else {
						timeLeft = await utils.checkTimeLeft()
					}
					if (!timeLeft.timeLeft) {
						utils.log(`Scraping stopped: ${timeLeft.message}`, "warning")
						interrupted = true
						break
					} else if (timeLeft.timeValue < 90 && profileCount > 45000) {
						utils.log("Scraping stopped: Less than 90 seconds left. You can check your execution time at https://phantombuster.com/usage", "warning")
						interrupted = true
						break
					} else if (profileCount > 150000 && timeLeft.timeValue < 1700) {
						utils.log("Scraping stopped: Less than 17OO seconds left. You can check your execution time at https://phantombuster.com/usage", "warning")
						interrupted = true
						break
					}
					try {
						[ res, twitterUrl, keepScraping ] = await scrapeFollowing(tab, profileUrl, twitterUrl, followersPerAccount)

					} catch (err) {
						if (resuming) {
							utils.log(`${err}, restarting followers scraping`, "warning")
							resuming = false
							await getJsonUrl(tab)
							twitterUrl = interceptedUrl
							profileCount = 0
							continue
						}
					}
					result = result.concat(res)
					profileCount += res.length
					displayResult++
					if (displayResult % 25 === 24) { utils.log(`Got ${profileCount} followers. Elapsed ${new Date() - initDate}`, "info") }
					buster.progressHint(profileCount / numberMaxOfFollowers, `Charging followers... ${profileCount}/${numberMaxOfFollowers}`)
					if (followersPerAccount && profileCount >= followersPerAccount) {
						if (fullScrape) {
							interrupted = true
						}
						break
					}
					if (rateLimited) {
						interrupted = true
						break
					}
				} while (keepScraping)
			}
		}
		if (isProtected) {
			utils.log(`Could not extract followers, ${twitterHandle} is protected.`, "warning")
			result.push({ query: profileUrl, error: "Profile Protected"})
			isProtected = false
		}
		if (followersPerAccount && !fullScrape) { result = result.slice(0, followersPerAccount) }
	} else {
		utils.log("Profile follows no one.", "warning")
		result.push({ query: profileUrl, error: "Profile follows no one" })
	}
	return result
}

const extractProfiles = (htmlContent, profileUrl) => {
	let profileList = htmlContent.split("ProfileTimelineUser")
	profileList.shift()
	const result = []
	for (const profile of profileList) {
		const data = {}
		const chr = cheerio.load(profile)
		data.userId = chr("div.ProfileCard").attr("data-user-id")
		const screenName = chr("div.ProfileCard").attr("data-screen-name")
		if (screenName) {
			data.screenName = screenName
			data.twitterUrl = "https://twitter.com/" + screenName
		}
		data.name = chr("a.ProfileCard-avatarLink").attr("title")
		let imgUrl = chr("img.ProfileCard-avatarImage").attr("src")
		if (imgUrl){
			if (imgUrl.endsWith("_bigger.png") || imgUrl.endsWith("_bigger.jpg") || imgUrl.endsWith("_bigger.jpeg")) { // removing _bigger to get the normal sized image
				imgUrl = imgUrl.replace("_bigger", "")
			}
			data.imgUrl = imgUrl
		}
		const background = chr("a.ProfileCard-bg").attr("style")
		if (background) {
			const pos = background.indexOf("background-image")
			if (pos > -1) {
				data.backgroundImg = background.slice(pos + 22, background.indexOf(")"))
			}
		}
		data.bio = chr("p").text()
		if (profile.includes("Icon--verified")) {
			data.certified = "Certified"
		}
		data.query = profileUrl
		data.timestamp = (new Date()).toISOString()
		result.push(data)
	}
	return result
}

;(async () => {
	const tab = await nick.newTab()
	let { sessionCookie, spreadsheetUrl, followersPerAccount, numberofProfilesperLaunch, csvName } = utils.validateArguments()
	if (!csvName) { csvName = "result" }
	let result = await utils.getDb(csvName + ".csv")
	const initialResultLength = result.length
	try {
		agentObject = await buster.getAgentObject()
	} catch (err) {
		utils.log(`Could not access agent Object. ${err.message || err}`, "warning")
	}
	if (initialResultLength && agentObject.nextUrl) {
		lastSavedQuery = "https://" + agentObject.nextUrl.match(/twitter\.com\/(@?[A-z0-9_]+)/)[0]
		alreadyScraped = result.filter(el => el.query === lastSavedQuery).length
	}
	if (!followersPerAccount) {
		followersPerAccount = 0
	}
	await twitter.login(tab, sessionCookie)
	tab.driver.client.on("Network.responseReceived", interceptTwitterApiCalls)

	let twitterUrls = [spreadsheetUrl]

	if (isUrl(spreadsheetUrl)) {
		if (!isTwitter(spreadsheetUrl)) {
			twitterUrls = await utils.getDataFromCsv2(spreadsheetUrl)
		}
	}
	twitterUrls = twitterUrls.filter(str => str) // removing empty lines
	if (twitterUrls.length === 1) {
		fullScrape = true
	}
	for (let i = 0; i < twitterUrls.length; i++) { // removing ending slash
		if (twitterUrls[i].endsWith("/")) { twitterUrls[i] = twitterUrls[i].slice(0, -1) }
	}

	for (let i = 0; i < twitterUrls.length; i++) { // converting (@)username to https://twitter.com/username
		if (!isUrl(twitterUrls[i])) {
			if (twitterUrls[i].startsWith("@")) { twitterUrls[i] = twitterUrls[i].substr(1)	}
			twitterUrls[i] = `https://twitter.com/${twitterUrls[i]}`.trim()
		}
	}

	if (!numberofProfilesperLaunch) {
		numberofProfilesperLaunch = twitterUrls.length
	}
	if (!fullScrape) {
		twitterUrls = getUrlsToScrape(twitterUrls.filter(el => checkDb(el, result)), numberofProfilesperLaunch)
	}
	console.log(`URLs to scrape: ${JSON.stringify(twitterUrls.slice(0, 500), null, 4)}`)

	twitterUrls = twitterUrls.map(el => require("url").parse(el).hostname ? el : removeNonPrintableChars(el))
	let urlCount = 0
	initDate = new Date()
	for (const url of twitterUrls) {
		let resuming = false
		if (alreadyScraped && agentObject && url === lastSavedQuery) {
			utils.log(`Resuming scraping for ${url}...`, "info")
			resuming = true
		} else {
			utils.log(`Scraping followers from ${url}`, "loading")
		}
		urlCount++
		buster.progressHint(urlCount / twitterUrls.length, `Processing profile n°${urlCount}...`)
		utils.log(`Getting followers for ${url}`, "loading")

		let followers = await getTwitterFollowing(tab, url, followersPerAccount, resuming)
		console.log("elapsed: ", new Date() - initDate)
		// followers = removeDuplicatesSelf(followers)
		console.log("elapsed2: ", new Date() - initDate)
		if (followers.length) {
			const followersLength = followers.length
			for (let i = 0; i < followersLength; i++) {
				if (!result.find(el => el.screenName === followers[i].screenName && el.query === followers[i].query)) {
					result.push(followers[i])
				}
			}
		}

		console.log("elapsed3: ", new Date() - initDate)
		if (interrupted) { break }
	}

	if (result.length !== initialResultLength) {
		utils.log(`Got ${result.length} followers in total.`, "done")
		await utils.saveResults(result, result, csvName)
		if (agentObject) {
			if (interrupted && twitterUrl) {
				agentObject.nextUrl = twitterUrl
				agentObject.timestamp = new Date()
			} else {
				delete agentObject.nextUrl
				delete agentObject.timestamp
			}
			await buster.setAgentObject(agentObject)
		}
	}
	tab.driver.client.removeListener("Network.responseReceived", interceptTwitterApiCalls)
	nick.exit()
})()
	.catch(err => {
		utils.log(err, "error")
		nick.exit(1)
	})
