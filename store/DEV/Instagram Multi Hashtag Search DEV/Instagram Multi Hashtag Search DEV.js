// Phantombuster configuration {
"phantombuster command: nodejs"
"phantombuster package: 5"
"phantombuster dependencies: lib-StoreUtilities.js, lib-Instagram.js, lib-WebSearch.js"

const url = require("url")
const { URL } = require("url")
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
const Instagram = require("./lib-Instagram")
const instagram = new Instagram(nick, buster, utils)
const WebSearch = require("./lib-WebSearch")

let graphql = null
let hashWasFound = false
let rateLimited = false
/* global $ */
// }

const ajaxCall = (arg, cb) => $.get({ type: "GET", url: arg.url, headers: arg.headers }).done(data => cb(null, data)).fail(err => cb(err.message || err))

/**
 * @description Tiny function used to check if a given string represents an URL
 * @param {String} target
 * @return { Boolean } true if target represents an URL otherwise false
 */
const isUrl = target => url.parse(target).hostname !== null


/**
 * @description The function will return every posts that match one more search terms
 * @param {Array} results scraped posts
 * @param {Array} terms the search terms
 * @param {Array} leastTerm the search term of the scraped posts
 * @return {Array} Array containing only posts which matches with one or more search terms
 */
const filterResults = (results, terms, leastTerm) => {
	let filterResult = []
	const regex = /#[a-zA-Z0-9\u00C0-\u024F]+/gu
	for (const term of terms) {
		if (term !== leastTerm) {
			for (const result of results) {
				if (result.description && result.description.toLowerCase().match(regex) && result.description.toLowerCase().match(regex).includes(term)) {
					result.matches = `${leastTerm} AND ${term}`
					filterResult.push(result)
				}
			}
		}
	}
	return filterResult
}

// get the post count from a given hashtag. If there's only few of them (<40), return 40
const getPostCount = (arg, callback) => {
	let postCount = 0
	if (document.querySelector("header > div:last-of-type span")) {
		postCount = document.querySelector("header > div:last-of-type span").textContent
		postCount = parseInt(postCount.replace(/,/g, ""), 10)
	} else {
		if (document.querySelector("article header ~ div h2 ~ div")) {
			postCount += document.querySelector("article header ~ div h2 ~ div").querySelectorAll("div > div > div > div > div[class]").length
		}
		if (document.querySelector("article header ~ h2 ~ div:not([class])")) {
			postCount += document.querySelector("article header ~ h2 ~ div:not([class])").querySelectorAll("div > div > div > div").length
		}
	}
	callback(null, postCount)
}

const interceptGraphQLHash = e => {
	if (e.request.url.indexOf("graphql/query/?query_hash") > -1 && e.request.url.includes("after") && !hashWasFound) {
		graphql = {}
		graphql.headers = e.request.headers
		const parsedUrl = new URL(e.request.url)
		graphql.hash = parsedUrl.searchParams.get("query_hash")
		graphql.variables = JSON.parse(parsedUrl.searchParams.get("variables"))
		hashWasFound = true
	}

}

const forgeAjaxURL = () => {
	const url = new URL("https://www.instagram.com/graphql/query/?query_hash&variables")
	url.searchParams.set("query_hash", graphql.hash)
	url.searchParams.set("variables", JSON.stringify(graphql.variables))
	return url.toString()
}

// Removes any duplicate post
const removeDuplicates = (arr) => {
	let resultArray = []
	for (let i = 0; i < arr.length ; i++) {
		if (!resultArray.find(el => el.postUrl === arr[i].postUrl)) {
			resultArray.push(arr[i])
		}
	}
	return resultArray
}

const scrapeFirstResults = (arg, cb) => {
	const results = document.querySelectorAll("main article img")
	const scrapedHashtags = []
	for (const result of results) {
		const hashtagData = { query: arg.hashtag }
		hashtagData.postUrl = result.parentElement.parentElement.parentElement.href
		scrapedHashtags.push(hashtagData)
	}
	cb(null, scrapedHashtags)
}

const extractFirstPosts = async (tab, results, firstResultsLength, query) => {
	for (let i = 0; i < firstResultsLength; i++) {
		if (results[i].postUrl) {
			try {
				await tab.open(results[i].postUrl)
				const scrapedData = await instagram.scrapePost2(tab, query)
				results[i] = scrapedData
			} catch (err) {
				//
			}
		}
		buster.progressHint(i / firstResultsLength, `${i} first posts extracted`)
	}
	return results
}


const scrapeFirstPage = async (tab, query) => {
	hashWasFound = false
	const initDate = new Date()
	do {
		await tab.wait(1000)
		await tab.scroll(0, - 1000)
		await tab.scrollToBottom()
		if (new Date() - initDate > 10000) {
			break
		}
	} while (!graphql)
	let data = await tab.evaluate(scrapeFirstResults, { query })
	const newlyScraped = data.length
	const postTab = await nick.newTab()
	data = await extractFirstPosts(postTab, data, newlyScraped, query)
	await postTab.close()
	return data
}

/**
	* @async
	* @description
	* @param {Object} tab - Nickjs Tab instance
	* @param {Array<Object>} arr - Array holding scraping results
	* @param {Number} maxPosts - Max posts to scrape
	* @param {String} term - Scraped term
	* @return {Promise<Boolean>} false is abort or rate limit
	*/
const scrapePosts = async (tab, arr, maxPosts, term) => {
	let i = 0
	graphql.variables.first = 50
	await tab.inject("../injectables/jquery-3.0.0.min.js")
	while (i < maxPosts) {
		const timeLeft = await utils.checkTimeLeft()
		if (!timeLeft.timeLeft) {
			utils.log(timeLeft.message, "warning")
			return false
		}
		buster.progressHint(i / maxPosts, term)
		let ajaxRes
		const ajaxUrl = forgeAjaxURL()
		try {
			ajaxRes = await tab.evaluate(ajaxCall, { url: ajaxUrl, headers: graphql.headers })
		} catch (err) {
			await tab.open(ajaxUrl)
			let instagramJsonCode = await tab.getContent()
			instagramJsonCode = JSON.parse("{" + instagramJsonCode.split("{").pop().split("}").shift() + "}")
			if (instagramJsonCode && instagramJsonCode.status === "fail") {
				utils.log(`Error getting hashtags : ${instagramJsonCode.message}`, "warning")
				rateLimited = true
			}
			return false
		}
		const cursor = term.startsWith("#") ? ajaxRes.data.hashtag.edge_hashtag_to_media.page_info : ajaxRes.data.location.edge_location_to_media.page_info
		const hashtags = term.startsWith("#") ? ajaxRes.data.hashtag.edge_hashtag_to_media.edges : ajaxRes.data.location.edge_location_to_media.edges
		if (!cursor.has_next_page && !cursor.end_cursor) {
			break
		} else {
			graphql.variables.after = cursor.end_cursor
			let toPush
			try {
				toPush = hashtags.map(el =>{ return { postUrl: `https://www.instagram.com/p/${el.node.shortcode}`, description: el.node.edge_media_to_caption.edges[0] ? el.node.edge_media_to_caption.edges[0].node.text : null } })
				i += hashtags.length
				arr.push(...toPush)
				utils.log(`Got ${i} posts `, "info")
			} catch (err) {
				//
			}
		}
	}
	buster.progressHint(1, term)
	return true
}

;(async () => {
	let { search, sessionCookie, columnName, csvName, maxPosts } = utils.validateArguments()
	const tab = await nick.newTab()
	await instagram.login(tab, sessionCookie)
	const webSearch = new WebSearch(tab, buster, null, null, utils)
	const scrapedData = []
	if (!csvName) { csvName = "result" }
	let hasSpreadsheet = false
	let csvData = []
	for (const el of search) {
		if (isUrl(el) && !el.includes("instagram.com/explore")) {
			csvData = await utils.getDataFromCsv2(el, columnName)
			hasSpreadsheet = true
		}
	}
	if (!hasSpreadsheet) { csvData = [ search.join(", ") ] }

	for (const line of csvData) {
		utils.log(`Searching for ${line}`, "done")
		let terms = line.split(",")
		terms = terms.filter((str => str)) // removing empty terms
		for (let i = 0; i < terms.length; i++) { // forcing lowercase
			terms[i] = terms[i].toLowerCase().trim();
		}
		terms = Array.from(new Set(terms)) // removing duplicates

		if (terms.length < 2) {
			utils.log("Need at least two different hashtags.", "error")
			nick.exit(1)
		}
		let scrapedResult = []
		// looking for the term with least results
		let leastTerm
		let removeTerm = []
		let sortArray = []
		let resultCount
		for (const term of terms) {
			if (term.startsWith("#")) {
				const targetUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(term.substr(1))}`
				const [httpCode] = await tab.open(targetUrl)
				if (httpCode === 404) {
					utils.log(`No results found for ${term}`, "warning")
					removeTerm.push(term)
					continue
				}

				try {
					await tab.waitUntilVisible("main", 30000)
				} catch (err) {
					utils.log(`Page is not opened: ${err.message || err}`, "error")
					removeTerm.push(term)
					continue
				}
				resultCount = await tab.evaluate(getPostCount)
				utils.log(`There's ${resultCount} posts for ${term}...`, "loading")
			} else {
				resultCount = 1
			}
			sortArray.push({ term, resultCount })
		}

		if (removeTerm.length) { // we remove every term that gave no results
			for (const term of removeTerm) {
				terms.splice(terms.indexOf(term), 1)
			}
			if (terms.length < 2) {
				utils.log("At least two terms with results needed.", "error")
				nick.exit(1)
			}
		}
		do {
			const timeLeft = await utils.checkTimeLeft()
			if (!timeLeft.timeLeft) {
				utils.log(`Scraping stopped: ${timeLeft.message}`, "warning")
				break
			}
			let minValue = sortArray[0].resultCount
			let minPos = 0
			for (let i = 1; i < sortArray.length; i++) { // finding the least popular term
				if (sortArray[i].resultCount < minValue) {
					minValue = sortArray[i].resultCount
					minPos = i
				}
			}
			if (!maxPosts) {
				maxPosts = minValue
			}
			leastTerm = sortArray[minPos].term
			const term = leastTerm
			let targetUrl = ""
			let inputType
			if (term.startsWith("https://www.instagram.com/explore/locations/")) {
				targetUrl = term
				inputType = "locations"
			} else {
				inputType = term.startsWith("#") ? "tags" : "locations"
				if (term.startsWith("#")) {
					targetUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(term.substr(1))}`
				} else {
					await tab.evaluate((arg, cb) => cb(null, document.location.reload()))
					try {
						await tab.waitUntilVisible("nav input", 5000)
					} catch (err) { // if the previous page had no result, there's no input field
						await tab.open("https://www.instagram.com")
						await tab.waitUntilVisible("nav input", 5000)
					}
					if (await tab.isVisible("nav input")) {
						targetUrl = await instagram.searchLocation(tab, term)
					}
				}
				if (!targetUrl) { // Using webSearch if we can't find location through instagram
					let search = await webSearch.search(term + "location instagram")
					let firstSearch
					if (search && search.results[0] && search.results[0].link) {
						firstSearch = search.results[0].link
						if (firstSearch.startsWith("https://www.instagram.com/explore/locations/")) {
							targetUrl = firstSearch
						} else {
							utils.log(`No search result page found for ${term}.`, "error")
							terms.splice(terms.indexOf(sortArray.splice(minPos, 1)[0].term), 1) // removing least popular result from sortArray and terms
							continue
						}
					}
				}
			}
			await tab.evaluate((arg, cb) => cb(null, document.location = arg.targetUrl), { targetUrl })

			try {
				await tab.waitUntilVisible("main", 30000)
			} catch (err) {
				utils.log(`Page is not opened: ${err.message || err}`, "error")
				terms.splice(terms.indexOf(sortArray.splice(minPos, 1)[0].term), 1)
				continue
			}
			utils.log(`Scraping posts for ${(inputType === "locations") ? "location" : "hashtag" } ${term}...`, "loading")

			//scraping the first page the usual way
			tab.driver.client.on("Network.requestWillBeSent", interceptGraphQLHash)
			scrapedResult = await scrapeFirstPage(tab, term)
			tab.driver.client.removeListener("Network.requestWillBeSent", interceptGraphQLHash)

			// we're graphql-scraping only if we didn't get all the results in the first page, or if it's a location term as we can't get the post count directly
			if (graphql && (!term.startsWith("#") || (scrapedResult && scrapedResult.length < sortArray[minPos].resultCount))) {
				try {
					await scrapePosts(tab, scrapedResult, maxPosts, term)
				} catch (err) {
					//
				}
			}

			scrapedResult = scrapedResult.slice(0, maxPosts) // only getting maxPosts results
			const filteredResults = removeDuplicates(filterResults(scrapedResult, terms, leastTerm))
			utils.log(`Got ${filteredResults.length} matching posts.`, "done")
			for (const post of filteredResults) {
				const timeLeft = await utils.checkTimeLeft()
				if (!timeLeft.timeLeft) {
					utils.log(`Scraping stopped: ${timeLeft.message}`, "warning")
					break
				}
				try {
					utils.log(`Scraping matching post ${post.postUrl}`, "info")
					buster.progressHint(scrapedData.length / filteredResults.length, "Scraping matching posts")
					await tab.open(post.postUrl)
					let scrapingRes = await instagram.scrapePost(tab)
					scrapingRes.timestamp = (new Date()).toISOString()
					scrapingRes.postUrl = post.postUrl
					scrapingRes.matches = post.matches
					scrapedData.push(scrapingRes)
				} catch (err) {
					utils.log(`Could not scrape ${post.postUrl}`, "warning")
				}
			}
			terms.splice(terms.indexOf(sortArray.splice(minPos, 1)[0].term), 1) // removing least popular result from sortArray and terms
			if (rateLimited) {
				utils.log("Rate limited by Instagram, exiting...", "warning")
				break
			}
		} while (sortArray.length >= 2)
		utils.log(`${scrapedData.length} posts scraped.`, "done")
	}
	if (scrapedData.length) {
		await utils.saveResults(scrapedData, scrapedData, csvName)
	}
	nick.exit(0)
})()
	.catch(err => {
		utils.log(err, "error")
		nick.exit(1)
	})
