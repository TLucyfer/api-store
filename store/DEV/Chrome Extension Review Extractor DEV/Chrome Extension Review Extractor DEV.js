// Phantombuster configuration {
"phantombuster command: nodejs"
"phantombuster package: 5"
"phantombuster dependencies: lib-StoreUtilities.js"

const Buster = require("phantombuster")
const buster = new Buster()

const Nick = require("nickjs")
const nick = new Nick({
	loadImages: false,
	printPageErrors: false,
	printResourceErrors: false,
	printNavigation: false,
	printAborts: false,
	debug: false
})

const StoreUtilities = require("./lib-StoreUtilities")
const utils = new StoreUtilities(nick, buster)
const DB_NAME = "result.csv"
const SHORT_DB_NAME = DB_NAME.split(".").shift()
const DEFAULT_URLS_PER_LAUNCH = 2
const MAX_ERRORS_ALLOWED = 3
const MIN_DEBOUNCE = 2500 // Minimal ms to wait before loading new reviews

const selectors = {
	root: "div[role=dialog]",
	reviewsTab: "div[role=tablist] > div[role=tab]:nth-child(2)",
	reviewsPanel: "div[role=tablist] ~ div:nth-child(3) div[webstore-source=ReviewsTab]",
	nextPaginationElement: "div[webstore-source=\"ReviewsTab\"] > div:last-of-type a:last-of-type",
	waitCondition: "div[webstore-source=\"ReviewsTab\"] > div:last-of-type span",
	filtersBase: "div[role=tablist] ~ div:nth-child(3) > div:nth-child(2) > div > div > div > div > div > span",
	dropDownBase: "div[role=tablist] ~ div:nth-child(3) > div:nth-child(2) > div > div > div > div > div > span > span:nth-child(1)",
	reviewsDropDownBase: "div[role=tablist] ~ div:nth-child(3) > div:nth-child(2) > div > div > div > div > div > span > span:last-of-type",
	dropDownSelection: "span ~ div > div:last-of-type",
	reviewsFilter: "span[role=button]:last-of-type",
	lastReviewInPage: "div[ga\\:type=\"CommentList\"] > div[ga\\:annotation-index]:last-of-type"
}

let globalErrors = 0
let rateLimit = false
// }

const handleSpreadsheet = async (url, column) => {
	const urls = []
	try {
		let tmp = await utils.getDataFromCsv2(url, column)
		urls.push(...tmp)
	} catch (err) {
		urls.push(url)
	}
	return urls
}

const getReviews = (arg, cb) => {
	const reviews = Array.from(document.querySelectorAll("div[webstore-source=\"ReviewsTab\"] > div:first-of-type > div:not(class)"))
	const toRet = reviews.map(el => {
		const review = {}
		const profileImgSel = el.querySelector("img")
		const dateSel = el.querySelector("a.comment-thread-displayname ~ span")
		const reviewer = el.querySelector("a.comment-thread-displayname")
		const _commentSel = el.querySelector("a.comment-thread-displayname ~ div[dir=auto]")
		if (reviewer) {
			review.name = reviewer.textContent.trim()
			review.profileLink = reviewer.href
		}
		review.profileImg = profileImgSel.src
		review.date = dateSel ? dateSel.textContent.trim() : ""
		review.mark = el.querySelectorAll("div.rsw-stars > div.rws-starred").length
		review.review = _commentSel ? _commentSel.textContent.trim() : ""
		review.url = arg.url
		review.timestamp = (new Date()).toISOString()
		return review
	})
	document.querySelector(arg.selectors.lastReviewInPage).scrollIntoView()
	cb(null, toRet)
}

/**
 * @description Tiny evaluate used to idle until new contents are loaded in the review listing,
 * the function will check every 200 ms if the current pagination stills the same value before the bot clicked the "next" pagination button
 * @param {Object} arg - Arguments used: waitCondition & lastCount which are representing the selector to watch and the value found before clicking
 * @param {Function} cb
 * @throws after 30s if the watched value didn't changed
 */
const waitUntilNewReviews = (arg, cb) => {
	const startTime = Date.now()
	const waitNewReviews = () => {
		const el = document.querySelector(arg.selectors.waitCondition)
		let val = 0
		if (el) {
			let tmp = el.textContent.trim().match(/\d+/g).map(el => parseInt(el, 10))
			tmp = tmp.filter(el => !isNaN(el))
			if (tmp.length === 3) {
				tmp.pop()
			}
			val = Math.min.apply(null, tmp)
		}
		if ((!val) || (val === arg.lastCount)) {
			if ((Date.now() - startTime) >= 30000) {
				cb("New reviews can't be loaded after 30s")
			}
			setTimeout(waitNewReviews, 200)
		} else {
			cb(null)
		}
	}
	waitNewReviews()
}

/**
 * @async
 * @description Function preforming a click by using DevTools protocols Input
 * Since click doesn't use under the hood Input.dispatchMouseEvent, here a tiny snippet
 * @param {Object} tab - Nickjs Tab instance
 * @param {String} selector - CSS selector to click
 * @throws Error if the click procedure failed
 */
const emulateHumanClick = async (tab, selector) => {

	const selectorPosition = await tab.evaluate((arg, cb) => {
		const tmp = document.querySelector(arg.selector).getBoundingClientRect()
		cb(null, tmp.toJSON())
	}, { selector })

	// Using Nickjs click mechanism to get coordinates in order to click at the center of the element
	let posX = 0.5
	let posY = 0.5

	posX = Math.floor(selectorPosition.width * (posX - (posX ^ 0)).toFixed(10)) + (posX ^ 0) + selectorPosition.left
	posY = Math.floor(selectorPosition.height * (posY - (posY ^ 0)).toFixed(10)) + (posY ^ 0) + selectorPosition.top

	const opts = { x: posX, y: posY, button: "left", clickCount: 1 }

	opts.type = "mousePressed"
	await tab.driver.client.Input.dispatchMouseEvent(opts)
	opts.type = "mouseReleased"
	await tab.driver.client.Input.dispatchMouseEvent(opts)
}

const scrollToLastVisibleReview	= (arg, cb) => cb(null, document.querySelector(arg.selector).scrollIntoView())

const scrapeExtensionName = (arg, cb) => cb(null, document.querySelector("h1").textContent.trim())

const loadAndScrape = async (tab, url) => {
	let ret = []
	ret = await tab.evaluate(getReviews, { selectors, url })
	await tab.wait(MIN_DEBOUNCE + Math.round(Math.random() * 200)) // Waiting at least 2000 ms before clicking in order to prevent bot detection system
	if (await tab.isVisible(selectors.nextPaginationElement)) {
		let tmp = await tab.evaluate((arg, cb) => {
			const el = document.querySelector(arg.selectors.waitCondition)
			let val = 0
			if (el) {
				let tmp = el.textContent.trim().match(/\d+/g).map(el => parseInt(el, 10))
				tmp = tmp.filter(el => !isNaN(el))
				if (tmp.length === 3) {
					tmp.pop()
				}
				val = Math.min.apply(null, tmp)
			}
			cb(null, val)
		}, { selectors })
		await tab.click(selectors.nextPaginationElement)
		try {
			await tab.evaluate(waitUntilNewReviews, { selectors, lastCount: tmp })
		} catch (err) {
			utils.log("Google rate limit detected, stopping scraping for this extension", "warning")
			rateLimit = true
		}
		await tab.evaluate(scrollToLastVisibleReview, { selector: selectors.lastReviewInPage })
	}
	return ret
}

/**
 * @async
 * @description Function used to scrape a single extension review
 * @param {Object} tab - Nickjs Tab instance
 * @param {string} url - Extension review URLs
 * @return {Promise<{ name: string, reviews: object[] }} Array containing all reviews or an empty array is an error happened
 */
const scrapeReviews = async (tab, url, maxCount = Infinity) => {
	let res = { name: "", reviews: [] }
	let extensionName
	try {
		const [httpCode] = await tab.open(url)
		if ((httpCode >= 300) || (httpCode < 200)) {
			utils.log(`Expecting HTTP code 200, but got ${httpCode} when opening URL: ${url}`, "warning")
			return res
		}
		await tab.waitUntilVisible(selectors.root, 15000)
		extensionName = await tab.evaluate(scrapeExtensionName)
		res.name = extensionName
		utils.log(`Scraping reviews for the extension ${extensionName} ...`, "loading")
		await emulateHumanClick(tab, selectors.reviewsTab)
		await tab.waitUntilVisible(selectors.reviewsPanel, 15000)
		await emulateHumanClick(tab, `${selectors.dropDownBase}`)
		await emulateHumanClick(tab, `${selectors.filtersBase} ${selectors.dropDownSelection}`)
		await emulateHumanClick(tab, `${selectors.reviewsDropDownBase}`)
		await emulateHumanClick(tab, `${selectors.reviewsDropDownBase} ${selectors.dropDownSelection}`)
		await tab.wait(1000)
		res.reviews = res.reviews.concat(await loadAndScrape(tab, url))
		utils.log(`Got ${res.reviews.length} reviews`, "info")

		while (await tab.isVisible(selectors.nextPaginationElement)) {
			const timeLeft = await utils.checkTimeLeft()
			if (!timeLeft.timeLeft) {
				break
			}
			res.reviews = res.reviews.concat(utils.filterRightOuter(res.reviews, await loadAndScrape(tab, url)))
			utils.log(`Got ${res.reviews.length} reviews`, "info")
			if (res.reviews.length >= maxCount) {
				res.reviews = res.reviews.slice(0, maxCount)
				break
			}
		}
	} catch (err) {
		utils.log(err.message || err, "warning")
		globalErrors++
		return res
	}
	globalErrors = 0
	return res
}

const createCsvOutput = json => {
	const ret = []
	for (const extension of Object.keys(json)) {
		ret.push(...json[extension].reviews)
	}
	return ret
}

;(async () => {
	const tab = await nick.newTab()
	let { spreadsheetUrl, columnName, extensionsPerLaunch, reviewsPerExtensions, csvName } = utils.validateArguments()
	let urls = []
	const scrapingRes = []
	let i = 0

	if (!csvName) {
		csvName = SHORT_DB_NAME
	}

	let db = await utils.getDb(csvName + ".csv")

	if (!extensionsPerLaunch) {
		extensionsPerLaunch = DEFAULT_URLS_PER_LAUNCH
	}

	if (spreadsheetUrl) {
		const queries = await handleSpreadsheet(spreadsheetUrl, columnName)
		urls = urls.concat(queries)
	} else {
		utils.log("You need to set a Spreadsheet OR an extension review URL in your API configuration.", "error")
		nick.exit(1)
	}

	urls = urls.filter(el => db.findIndex(line => line.url === el) < 0).slice(0, extensionsPerLaunch)
	if (urls.length < 1) {
		utils.log("Input is empty OR all urls are already scraped", "warning")
		nick.exit(0)
	}

	for (const url of urls) {
		if (globalErrors >= MAX_ERRORS_ALLOWED) {
			utils.log(`Got ${globalErrors} errors while scraping reviews, aborting execution`, "warning")
			break
		}
		const timeLeft = await utils.checkTimeLeft()
		if (!timeLeft.timeLeft) {
			utils.log(timeLeft.message, "warning")
			break
		}
		buster.progressHint((i + 1) / urls.length, `${url}`)
		if (rateLimit) {
			await tab.wait(100000) // Wait 1min if the error count has been incremented
			rateLimit = !rateLimit
		}
		const reviewRes = await scrapeReviews(tab, url, reviewsPerExtensions)
		utils.log(`Got ${reviewRes.reviews.length} reviews from ${reviewRes.name}`, "done")
		scrapingRes.push(reviewRes)
		i++
	}
	db = db.concat(createCsvOutput(scrapingRes))
	await utils.saveResults(scrapingRes, db, csvName, null, false)
	nick.exit()
})()
.catch(err => {
	utils.log(err.message || err, "error")
	nick.exit(1)
})
