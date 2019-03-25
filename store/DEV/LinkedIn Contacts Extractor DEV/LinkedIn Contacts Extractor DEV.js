// Phantombuster configuration {
"phantombuster command: nodejs"
"phantombuster package: 5"
"phantombuster dependencies: lib-StoreUtilities.js, lib-LinkedIn-DEV.js"
"phantombuster flags: save-folder"

const Buster = require("phantombuster")
const buster = new Buster()

const Nick = require("nickjs")
const nick = new Nick({
	loadImages: true,
	printPageErrors: false,
	printResourceErrors: false,
	printNavigation: false,
	printAborts: false,
	debug: false,
	height: (1700 + Math.round(Math.random() * 200)), // 1700 <=> 1900
	timeout: 30000
})
const StoreUtilities = require("./lib-StoreUtilities")
const utils = new StoreUtilities(nick, buster)
const LinkedIn = require("./lib-LinkedIn-DEV")
const linkedIn = new LinkedIn(nick, buster, utils)
// }

// return the number of Connections profiles visible on the page
const getConnectionsCount = (arg, cb) => cb(null, document.querySelectorAll(".mn-connections > ul > li").length)

// Connections scraping
const scrapeConnectionsProfilesAndRemove = (arg, cb) => {
	const results = document.querySelectorAll(".mn-connections > ul > li")
	const scrapedData = []
	for (let i = 0 ; i < results.length - arg.limiter ; i++) {
		const scrapedObject = {}
		if (results[i].querySelector("a")) {
			scrapedObject.profileUrl = results[i].querySelector("a").href
		}
		if (results[i].querySelector(".mn-connection-card__name")) {
			scrapedObject.name = results[i].querySelector(".mn-connection-card__name").innerText
			let nameArray = scrapedObject.name.split(" ")
			const firstName = nameArray.shift()
			const lastName = nameArray.join(" ")
			scrapedObject.firstName = firstName
			if (lastName) {
				scrapedObject.lastName = lastName
			}
		}
		if (results[i].querySelector(".mn-connection-card__occupation")) {
			scrapedObject.title = results[i].querySelector(".mn-connection-card__occupation").innerText
		}
		if (results[i].querySelector("time.time-ago")) {
			let connectedDate = results[i].querySelector("time.time-ago").innerText
			connectedDate = connectedDate.split(" ")
			connectedDate.shift()
			scrapedObject.connectedDate = connectedDate.join(" ")
		}
		if (results[i].querySelector(".presence-entity__image")) {
			const backgroundStyle = results[i].querySelector(".presence-entity__image")
			if (backgroundStyle && backgroundStyle.style && backgroundStyle.style.backgroundImage) {
				let backgroundImageUrl = backgroundStyle.style.backgroundImage
				backgroundImageUrl = backgroundImageUrl.slice(backgroundImageUrl.indexOf("\"") + 1)
				backgroundImageUrl = backgroundImageUrl.slice(0, backgroundImageUrl.indexOf("\""))
				scrapedObject.profileImageUrl = backgroundImageUrl
			}
		}
		scrapedObject.timestamp = (new Date()).toISOString()
		scrapedData.push(scrapedObject)
		results[i].parentElement.removeChild(results[i])
	}
	cb(null, scrapedData)
}

// handle loading and scraping of Connections profiles
const loadConnectionsAndScrape = async (tab, numberOfProfiles, letter) => {
	console.log("numberof:", numberOfProfiles)
	if (letter) {
		try {
			await tab.waitUntilVisible("div.mn-connections__search-container input")
			await tab.wait(5000)
			await tab.sendKeys("div.mn-connections__search-container input", letter, { reset: true })
			const initDate = new Date()
			while (!await tab.isVisible("li-icon.blue.loader")) {
				console.log("waiting the loader")
				await tab.wait(10)
				if (new Date() - initDate > 2000) {
					break
				}
			}
			while (await tab.isVisible("li-icon.blue.loader")) {
				console.log("waiting to load")
				await tab.wait(10)
				if (new Date() - initDate > 4000) {
					break
				}
			}
		} catch (err) {
			console.log("err:", err)
		}
	}

	await tab.screenshot(`${Date.now()}letter${letter}.png`)
	await buster.saveText(await tab.getContent(), `${Date.now()}letter${letter}.html`)
	let result = []
	if (letter) {
		if (await tab.isVisible("div.mn-connections__empty-search")) {
			utils.log(`Couldn't find any connection with letter ${letter}`, "info")
			return result
		}
	}
	let scrapeCount = 0
	let connectionsCount = 0
	let lastDate = new Date()
	do {
		const timeLeft = await utils.checkTimeLeft()
		if (!timeLeft.timeLeft) {
			utils.log(timeLeft.message, "warning")
			break
		}
		const newConnectionsCount = await tab.evaluate(getConnectionsCount)
		if (newConnectionsCount > connectionsCount) {
			const tempResult = await tab.evaluate(scrapeConnectionsProfilesAndRemove, { limiter: 30 })
			// await tab.screenshot(`${Date.now()}letter${letter}.png`)
			// await buster.saveText(await tab.getContent(), `${Date.now()}letter${letter}.html`)
			result = result.concat(tempResult)
			scrapeCount = result.length
			if (scrapeCount) {
				utils.log(`Scraped ${numberOfProfiles ? Math.min(scrapeCount, numberOfProfiles) : scrapeCount} profiles.`, "done")
			}
			buster.progressHint(Math.min(scrapeCount, numberOfProfiles) / numberOfProfiles, `${scrapeCount} profiles scraped`)
			connectionsCount = 30
			lastDate = new Date()
			await tab.scroll(0, -2000)
			await tab.wait(400)
			await tab.scrollToBottom()
		}
		if (new Date() - lastDate > 10000) {
			if (result.length && await tab.isVisible(".artdeco-spinner-bars")) {
				utils.log("Scrolling took too long!", "warning")
			}
			break
		}
		await tab.wait(1000)
	} while (!numberOfProfiles || scrapeCount < numberOfProfiles)
	result = result.concat(await tab.evaluate(scrapeConnectionsProfilesAndRemove, { limiter: 0 })) // scraping the last ones when out of the loop then slicing
	result = result.slice(0, numberOfProfiles)
	const resultLength = result.length
	if (resultLength) { // if we scraped posts without more loading
		utils.log(`Scraped ${resultLength} profile${resultLength > 1 ? "s" : ""}.`, "done")
	} else {
		utils.log("No profiles found!", "warning")
	}
	return result
}

// handle scraping of Connections profiles
const getConnections = async (tab, numberOfProfiles, sortBy, advancedLoading) => {
	let result = []
	try {
		await tab.open("https://www.linkedin.com/mynetwork/invite-connect/connections/")
		await tab.waitUntilVisible(".mn-connections__actions-container")
		if (sortBy !== "Recently added") {
			try {
				await tab.click("button[data-control-name=\"sort_by\"]")
				await tab.waitUntilVisible("li.mn-connections__sort-options")
				if (sortBy === "First name") {
					await tab.click("div[data-control-name=\"sort_by_first_name\"]")
				} else {
					await tab.click("div[data-control-name=\"sort_by_last_name\"]")
				}
			} catch (err) {
				utils.log(`Error changing profile order: ${err}`)
			}
		}
		utils.log("Loading Connections profiles...", "loading")
		let totalCount
		try {
			totalCount = await tab.evaluate((arg, cb) => {
				cb(null, document.querySelector(".mn-connections__header h1").textContent.replace(/\D+/g,""))
			})
			if (totalCount) {
				utils.log(`Total Connections Count is ${totalCount}.`, "info")
			}
		} catch (err) {
			//
		}
		if (advancedLoading) {
			const letterArray = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "t", "u", "v", "w", "x", "y", "z"]
			// const letterArray = ["a", "b"]
			for (const letter of letterArray) {
				console.log("Letter:", letter)
				const tempResult = await loadConnectionsAndScrape(tab, numberOfProfiles, letter)
				for (let i = 0; i < tempResult.length; i++) {
					if (!result.find(el => el.profileUrl === tempResult[i].profileUrl)) {
						result.push(tempResult[i])
					}
				}
				const timeLeft = await utils.checkTimeLeft()
				if (!timeLeft.timeLeft) {
					utils.log(timeLeft.message, "warning")
					break
				}
				await tab.evaluate((arg, cb) => cb(null, document.location.reload()))
			}
		} else {
			result = await loadConnectionsAndScrape(tab, numberOfProfiles)
		}
	} catch (err) {
		utils.log(`Error getting Connections:${err}`, "error")
	}
	return result
}



;(async () => {
	const tab = await nick.newTab()
	let { sessionCookie, numberOfProfiles, sortBy, csvName, advancedLoading } = utils.validateArguments()
	if (!csvName) { csvName = "result" }
	let result = await utils.getDb(csvName + ".csv")
	let tempResult
	await linkedIn.login(tab, sessionCookie)
	const newResult = []
	try {
		tempResult = await getConnections(tab, numberOfProfiles, sortBy, advancedLoading)
		if (tempResult && tempResult.length) {
			for (let i = 0; i < tempResult.length; i++) {
				if (!result.find(el => el.profileUrl === tempResult[i].profileUrl)) {
					result.push(tempResult[i])
					newResult.push(tempResult[i])
				}
			}
		}
	} catch (err) {
		utils.log(`Error : ${err}`, "error")
	}
	const newProfiles = newResult.length
	if (newProfiles) {
		utils.log(`${newProfiles} new profile${newProfiles > 1 ? "s" : ""} found.`, "done")
	} else {
		utils.log("No new profile found", "done")
	}
	await utils.saveResults(newResult, result, csvName)
	await linkedIn.updateCookie()
	nick.exit(0)
})()
	.catch(err => {
		utils.log(err, "error")
		nick.exit(1)
	})
