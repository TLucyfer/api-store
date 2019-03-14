// Phantombuster configuration {
"phantombuster command: nodejs"
"phantombuster package: 4"
"phantombuster dependencies: lib-StoreUtilities.js, lib-LinkedIn.js"

const Buster = require("phantombuster")
const buster = new Buster()

const Nick = require("nickjs")
const nick = new Nick({
	loadImages: true,
	userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.12; rv:54.0) Gecko/20100101 Firefox/54.0",
	printPageErrors: false,
	printResourceErrors: false,
	printNavigation: false,
	printAborts: false,
	timeout: 30000
})

const StoreUtilities = require("./lib-StoreUtilities")
const utils = new StoreUtilities(nick, buster)
const LinkedIn = require("./lib-LinkedIn")
const linkedIn = new LinkedIn(nick, buster, utils)
// }

const unique = (left, right) => {
	const rLength = right.length
	const res = right.slice(0)
	for (let i = 0; i < rLength; i++) {
		const leftIdx = left.findIndex(el => el.profileLink === right[i].profileLink && el.query === right[i].query)
		if (leftIdx > -1) {
			res[leftIdx] = right[i]
		}
	}
	return res
}

// Get the number of comments loaded
const getLikesNumber = (arg, callback) => {
	callback(null, document.querySelectorAll("li.actor-item").length)
}

// Scroll the likes list to load other likes
const scrollLikes = (arg, callback) => {
	const list = document.querySelector(arg.listSelector)
	list.scroll(0, list.scrollHeight)
	callback()
}

// Loop to load all the likes
const loadAllLikes = async (tab, listSelector) => {
	let likeCount = await tab.evaluate(getLikesNumber)
	while (true) {
		const timeLeft = await utils.checkTimeLeft()
		if (!timeLeft.timeLeft) {
			utils.log(`Stopped loading likers: ${timeLeft.message}`, "warning")
			break
		}
		try {
			await tab.evaluate(scrollLikes, { listSelector })
			await tab.waitUntilVisible(`li.actor-item:nth-child(${likeCount + 1})`)
			likeCount = await tab.evaluate(getLikesNumber)
		} catch (error) {
			if (likeCount) {
				utils.log(`Loaded ${likeCount} likes.`, "info")
			}
			return (likeCount)
		}
	}
}

// Get all likes infos after they are all loaded
const scrapeLikes = (arg, callback) => {
	const result = []
	const likes = document.querySelectorAll("li.actor-item")
	for (const like of likes) {
		const name = Array.from(like.querySelector(".profile-link > h3.name").childNodes).filter(el => el.nodeType === Node.TEXT_NODE).map(el => el.textContent.trim()).join("")
		result.push({
			profileLink: like.querySelector("a").href,
			name,
			job: like.querySelector(".profile-link > p.headline").textContent.trim(),
			degree: like.querySelector(".dist-value") ? like.querySelector(".dist-value").textContent.trim() : null
		})
	}
	callback(null, result)
}

// Function to launch every others and handle errors
const getLikes = async (tab, urls, removeDuplicates = false) => {
	let results = []
	const selectors = {}

	for (const url of urls) {
		try {
			utils.log(`Processing ${url}...`, "loading")
			await tab.open(url)
		} catch (error) {
			utils.log("Could not open publication URL please check the validity of the URL", "error")
			results.push({ postUrl: url, timestamp: (new Date()).toISOString(), error: "Could not open URL" })
			continue
		}
		try {
			/**
			 * to check if the opened page is a real article, we need to check:
			 * If we got selectors for like, comment, and likes count
			 * We store, selectors in selectors.likes variable
			 */
			selectors.likes = await tab.waitUntilVisible(["button.feed-shared-social-counts__num-likes.feed-shared-social-counts__count-value",
				"button.feed-shared-social-counts", "button.feed-shared-social-counts__nums-likes",
				"button.reader-social-bar__like-count.reader-social-bar__count"], 15000, "or")
			await tab.click(selectors.likes)
			/**
			 * this waitUntilVisible call checks if we got:
			 * - some selectors loaded in order to open the popup in order to scrape the likers
			 */
			selectors.list = await tab.waitUntilVisible(["ul.feed-shared-likers-modal__actor-list.actor-list", "ul.feed-shared-likes-list__list"], 15000, "or")
		} catch (error) {
			const err = `${url} seems not to be a publication OR doesn't have any likes`
			utils.log(err, "warning")
			results.push({ postUrl: url, timestamp: (new Date()).toISOString(), error: err })
			continue
		}
		try {
			await loadAllLikes(tab, selectors.list)
			utils.log("All likes loaded, scrapping all likes...", "done")
		} catch (error) {
			utils.log("Could not load likes", "warning")
		}
		let likes = await tab.evaluate(scrapeLikes)
		likes.map(el => {
			el.postUrl = url
			el.timestamp = (new Date()).toISOString()
			return el
		})
		if (removeDuplicates) {
			results = unique(results, likes) // results.concat(unique(results, likes))
		} else {
			results = results.concat(likes)
		}
		const timeLeft = await utils.checkTimeLeft()
		if (!timeLeft.timeLeft) {
			utils.log(`Scraping stopped: ${timeLeft.message}`, "warning")
			break
		}
	}
	return results
}

// Main function to launch everything and handle errors
;(async () => {
	const tab = await nick.newTab()
	let db = null
	let { sessionCookie, postUrl, columnName, csvName, removeDuplicate } = utils.validateArguments()

	if (!csvName) {
		csvName = "result"
	}
	// Issue #157: append the content instead of overwritting the db
	db = await utils.getDb(csvName + ".csv")
	if (postUrl.indexOf("linkedin.com/") < 0) {
		postUrl = await utils.getDataFromCsv2(postUrl, columnName)
	} else {
		postUrl = [ postUrl ]
	}
	if (postUrl.length < 1) {
		utils.log("Every posts are scraped (you need to wait one day to rescrape them) OR input is empty", "warning")
		nick.exit()
	}
	utils.log(`URLs to scrape: ${JSON.stringify(postUrl, null, 2)}`, "info")
	await linkedIn.login(tab, sessionCookie)
	const results = await getLikes(tab, postUrl, removeDuplicate)
	db.push(...utils.filterRightOuter(db, results))
	utils.log(`Got ${results.length} likers in total.`, "done")
	await linkedIn.updateCookie()
	await utils.saveResult(db, csvName)
})()
	.catch(err => {
		utils.log(err, "error")
		console.log(err.stack || err)
		nick.exit(1)
	})
