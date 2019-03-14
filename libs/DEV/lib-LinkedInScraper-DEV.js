// Phantombuster configuration {
"phantombuster dependencies: lib-Hunter.js, lib-Dropcontact-DEV.js, lib-DiscoverMail.js"
// }
const { URL } = require ("url")


/**
 * Slowly but surely loading all sections of the profile
 */
const fullScroll = async tab => {
	for (let i = 1000; i < 4000; i += 1000) {
		await tab.scroll(0, i)
		await tab.wait(1000)
	}
	await tab.scrollToBottom()
	await tab.wait(1000)
}

// Load all data hidden behind "load more" buttons
const loadProfileSections = async tab => {
	/**
	 * Selectors:
	 * - Description section
	 * - Jobs section
	 * - Skills section (CSS selector)
	 * - Skills section (alternative CSS selector)
	 * - Details section
	 */
	const buttons = [
		{ selector: ".pv-profile-section button.pv-top-card-section__summary-toggle-button", waitCond: ".pv-profile-section button.pv-top-card-section__summary-toggle-button[aria-expanded=false]", noSpinners: true },
		{ selector: ".pv-profile-section__actions-inline button.pv-profile-section__see-more-inline", waitCond: ".pv-profile-section__actions-inline button.pv-profile-section__see-more-inline", noSpinners: false },
		{ selector: ".pv-profile-section.pv-featured-skills-section button.pv-skills-section__additional-skills", waitCond: ".pv-profile-section.pv-featured-skills-section button.pv-skills-section__additional-skills", noSpinners: true },
		{ selector: ".pv-profile-section__card-action-bar.pv-skills-section__additional-skills", waitCond: ".pv-profile-section__card-action-bar.pv-skills-section__additional-skills[aria-expanded=false]", noSpinners: true }, // Issue #40: endorsements dropdown wasn't open, the CSS selector changed
		{ selector: "button.contact-see-more-less", waitCond: "button.contact-see-more-less", noSpinners: false },
	]
	const spinnerSelector = "div.artdeco-spinner"
	// In order to completely load all sections for a profile, the script click until a condition is false
	// waitCond field represent the selector which will stop the complete load of a section
	let initDate
	for (const button of buttons) {
		let stop = false
		initDate = new Date()
		while (!stop && await tab.isPresent(button.waitCond)) {
			const visible = await tab.isVisible(button.selector)
			if (visible) {
				try {
					await tab.click(button.selector)
					if (!button.noSpinners) {
						if (await tab.isVisible(spinnerSelector)) {
							await tab.waitWhileVisible(spinnerSelector)
						} else {
							await tab.wait(2500)
						}
					}
				} catch (err) {
					stop = true
				}
			} else {
				stop = true
			}
			if (new Date() - initDate > 10000) {
				break
			}
		}
	}
	// Restore the initial position on the page after loading all sections
	await tab.scroll(0, 0)
}

/**
 * @description Browser context function used to scrape all contact infos from LinkedIn profile
 * @param {Object} arg
 * @param {Function} callback
 * @return Object LinkedIn profile contact infos
 */
const getDetails = (arg, callback) => {
	let details = {}
	const getInfos = (infos, selector) => {
		if (!selector) {
			selector = document
		}
		const result = {}
		for (const info of infos) {
			if (selector.querySelector(info.selector) && selector.querySelector(info.selector)[info.attribute]) {
				result[info.key] = selector.querySelector(info.selector)[info.attribute].trim()
			} else if (selector.querySelector(info.selector) && selector.querySelector(info.selector).getAttribute(info.attribute)) {
				result[info.key] = selector.querySelector(info.selector).getAttribute(info.attribute).trim()
			} else if (selector.querySelector(info.selector) && selector.querySelector(info.selector).style[info.style]) {
				/**
				 * this workflow is used to get CSS styles values
				 * For now it's used when we need to scrape background-image
				 * we remove those parts of the result string: url(" & ")
				 */
				result[info.key] =
									selector.querySelector(info.selector)
											.style[info.style]
											.trim()
											.replace("url(\"", "")
											.replace("\")", "")
			}
		}
		return result
	}

	details = getInfos([
		{ key: "linkedinProfile", attribute: "href", selector: ".ci-vanity-url .pv-contact-info__contact-link" },
		{ key: "websites", attribute: "textContent", selector: ".ci-websites .pv-contact-info__contact-link" },
		{ key: "twitter", attribute: "textContent", selector: ".ci-twitter .pv-contact-info__contact-link" },
		{ key: "facebook", attribute: "href", selector: ".pv-profile-section__section-info a[href*=\"www.facebook.com\"]" },
		{ key: "im", attribute: "innerText", selector: ".pv-profile-section__section-info .ci-ims li" },
		{ key: "birthday", attribute: "textContent", selector: ".pv-profile-section__section-info .ci-birthday span" },
		{ key: "connectedOn", attribute: "textContent", selector: ".pv-profile-section__section-info .ci-connected span" },
		{ key: "phone", attribute: "textContent", selector: ".pv-profile-section__section-info .ci-phone span" },
		{ key: "mail", attribute: "textContent", selector: ".ci-email .pv-contact-info__contact-link" }
	], document.querySelector("artdeco-modal")
	)
	callback(null, details)
}

// Function executed in the browser to get all data from the profile
const scrapeInfos = (arg, callback) => {
	// Generic function to get infos from a selector and check if this selector exists
	const getInfos = (infos, selector) => {
		if (!selector) {
			selector = document
		}
		const result = {}
		for (const info of infos) {
			if (selector.querySelector(info.selector) && selector.querySelector(info.selector)[info.attribute]) {
				result[info.key] = selector.querySelector(info.selector)[info.attribute].trim()
			} else if (selector.querySelector(info.selector) && selector.querySelector(info.selector).getAttribute(info.attribute)) {
				result[info.key] = selector.querySelector(info.selector).getAttribute(info.attribute).trim()
			} else if (selector.querySelector(info.selector) && selector.querySelector(info.selector).style[info.style]) {
				/**
				 * this workflow is used to get CSS styles values
				 * For now it's used when we need to scrape background-image
				 * we remove those parts of the result string: url(" & ")
				 */
				result[info.key] =
									selector.querySelector(info.selector)
										.style[info.style]
										.trim()
										.replace("url(\"", "")
										.replace("\")", "")
			}
		}
		return result
	}
	// Generic function to get a list of selectors and check if they exist
	const getListInfos = (list, tab) => {
		const result = []
		for (const item of list) {
			result.push(getInfos(tab, item))
		}
		return result
	}

	/**
	 * @description Function used removed nested array from the list parameter
	 * Use Infinity if you want remove depth restrictions
	 * @param {Array<Any>} list
	 * @param {Number} [depth] - Recursion calls to be performed
	 * @return <Array<Any>> Flatten array
	 */
	const flatArray = (list, depth = 3) => {
		depth = ~~depth
		if (depth === 0) return list
		return list.reduce((acc, val) => {
			if (Array.isArray(val)) {
				acc.push(...flatArray(val, depth - 1))
			} else {
				acc.push(val)
			}
			return acc
		}, [])
	}

	const infos = {}
	if (document.querySelector(".pv-profile-section.pv-top-card-section")) {
		// Get primary infos
		infos.general = getInfos([
			/**
			 * we need to pass an array for the imgUrl, because
			 * CSS selectors changes depending of 2 followed situations:
			 * 1 - if you look YOUR linkedIn profile with YOUR li_at cookie: it will be .pv-top-card-section__profile-photo-container img
			 * 2 - if you look SOMEONE ELSE linkedIn profile with YOUR li_at cookie: it will be .presence-entity__image
			 */
			/**
			 * various field is an object depending what you need to get
			 */
			{ key: "imgUrl", style: "backgroundImage", selector: ".presence-entity__image" },
			{ key: "imgUrl", attribute: "src", selector: ".profile-photo-edit__preview" },
			{ key: "fullName", attribute: "textContent", selector: ".pv-top-card-section__name" },
			{ key: "fullName", attribute: "aria-label", selector: "#profile-wrapper div.presence-entity__image" },
			{ key: "hasAccount", attribute: "textContent", selector: ".pv-member-badge .visually-hidden" },
			{ key: "headline", attribute: "textContent", selector: ".pv-top-card-section__headline" },
			{ key: "company", attribute: "textContent", selector: ".pv-top-card-section__company"},
			{ key: "company", attribute: "textContent", selector: ".pv-top-card-v2-section__link.pv-top-card-v2-section__link-experience.mb1" }, // Issue #52
			{ key: "school", attribute: "textContent", selector: ".pv-top-card-section__school"},
			{ key: "school", attribute: "textContent", selector: ".pv-top-card-v2-section__entity-name.pv-top-card-v2-section__school-name" }, // Issue #52
			{ key: "location", attribute: "textContent", selector: ".pv-top-card-section__location"},
			{ key: "connections", attribute: "textContent", selector: ".pv-top-card-section__connections > span"},
			{ key: "connections", attribute: "textContent", selector: ".pv-top-card-v2-section__entity-name.pv-top-card-v2-section__connections" } // Issue #52
			// { key: "description", attribute: "textContent", selector: ".pv-top-card-section__summary-text"},
		])
		infos.general.profileUrl = document.location.href

		const sel = document.querySelector(".pv-profile-section.pv-top-card-section .pv-top-card-v2-section__entity-name.pv-top-card-v2-section__connections")
		if (sel) {
			/**
			 * Issue #52
			 * Scrapping only the number not the text (thanks to the new Linkedin UI)
			 */
			infos.general.connections = sel.textContent.trim().match(/\d+\+?/)[0]
		}

		if (document.querySelector(".dist-value")) {
			infos.general.connectionDegree = document.querySelector(".dist-value").textContent
		}

		// extract the vmid from the page code
		try {
			const entityUrn = JSON.parse(Array.from(document.querySelectorAll("code")).filter(el => el.textContent.includes("urn:li:fs_memberBadges"))[0].textContent).data.entityUrn
			infos.general.vmid = entityUrn.slice(entityUrn.indexOf("memberBadges:") + 13)
			if (infos.general.vmid) {
				infos.general.linkedinSalesNavigatorUrl = `https://www.linkedin.com/sales/people/${infos.general.vmid},name`
			}
		} catch (err) {
			//
		}
		if (document.querySelector("#highlights-container a[data-control-name=\"highlight_entity_url_card_action_click\"]")) {
			infos.general.mutualConnectionsUrl = document.querySelector("#highlights-container a[data-control-name=\"highlight_entity_url_card_action_click\"]").href
		}
		/**
		 * Issue #49 lib-LinkedInScraper: Better description field extraction
		 * the description selector can contains br span tags,
		 * the code below replace all br tags by a newline character, and remove ellipsis string used by LinkedIn
		 */
		if (document.querySelector(".pv-top-card-section__summary-text")) {
			let ellipsis = document.querySelector(".lt-line-clamp__ellipsis.lt-line-clamp__ellipsis--dummy")
			ellipsis.parentNode.removeChild(ellipsis)
			let tmpRaw =
				document.querySelector(".pv-top-card-section__summary-text")
					.innerHTML
					.replace(/(<\/?br>)/g, "\n")
			document.querySelector(".pv-top-card-section__summary-text").innerHTML = tmpRaw
			infos.general.description = document.querySelector(".pv-top-card-section__summary-text").textContent.trim()
		} else {
			infos.general.description = ""
		}
		// Get subscribers count
		if (document.querySelector("div.pv-profile-section.pv-recent-activity-section")) {
			/**
			 * Issue #12 Cannot read property 'textContent' of null
			 * This selector is not always available, the script should test before accessing data from the selector
			 */
			if (document.querySelector("div.pv-profile-section.pv-recent-activity-section h3.pv-recent-activity-section__follower-count > span")) {
				const subscribersText = document.querySelector("div.pv-profile-section.pv-recent-activity-section h3.pv-recent-activity-section__follower-count > span").textContent.trim().replace(/,/g, "").replace(/\./g, "").replace(/\s/g, "")
				if (subscribersText.match(/[0-9]*/g)) {
					infos.general.subscribers = subscribersText.match(/[0-9]*/g)[0]
				}
			}
		}
		if (document.querySelector("a[data-control-name=\"view_profile_in_recruiter\"]")) {
			infos.general.linkedinRecruiterUrl = document.querySelector("a[data-control-name=\"view_profile_in_recruiter\"]").href
		}
		if (document.querySelector("a[data-control-name=\"topcard_view_all_connections\"]")) {
			infos.general.connectionsUrl = document.querySelector("a[data-control-name=\"topcard_view_all_connections\"]").href
		}
		if (document.querySelector("span.background-details")) {
			// Get all profile jobs listed
			// Issue 128: new UI (experiences are stacked in a li if the company doesn't change)
			const jobs = document.querySelectorAll("section.pv-profile-section.experience-section ul li.pv-profile-section")
			if (jobs) {
				// Expand all descriptions
				Array.from(jobs).map(el => {
					const t = el.querySelector("span.lt-line-clamp__line.lt-line-clamp__line--last a")
					t && t.click()
					return t !== null
				})

				const extractJobDescription = el => {
					let description = null
					if (el.querySelector(".pv-entity__description")) {
						let seeMoreElement = el.querySelector(".lt-line-clamp__ellipsis")
						let seeLessElement = el.querySelector(".lt-line-clamp__less")
						if (seeMoreElement) {
							seeMoreElement.parentNode.removeChild(seeMoreElement)
						}
						if (seeLessElement) {
							seeLessElement.parentNode.removeChild(seeLessElement)
						}
						let cleanedHTML = el.querySelector(".pv-entity__description").innerHTML.replace(/(<\/?br>)/g, "\n")
						el.querySelector(".pv-entity__description").innerHTML = cleanedHTML
						description = el.querySelector(".pv-entity__description") ? el.querySelector(".pv-entity__description").textContent.trim() : null
					}
					return description
				}

				/**
				 * Issue #128: removing getListInfos call while scraping jobs
				 * Specific process used when scraping jobs descriptions
				 * (same as profile description)
				 */
				infos.jobs = Array.from(jobs).map(el => {
					let job = {}

					/**
					 * Issue #128: Different positions in the same company need a specific handler
					 */
					if (el.querySelector(".pv-entity__position-group")) {
						let companyName = (el.querySelector(".pv-entity__company-details .pv-entity__company-summary-info span:last-of-type") ? el.querySelector(".pv-entity__company-details .pv-entity__company-summary-info span:last-of-type").textContent.trim() : null)
						let companyUrl = (el.querySelector("a[data-control-name=\"background_details_company\"]") ? el.querySelector("a[data-control-name=\"background_details_company\"]").href : null)
						return Array.from(el.querySelectorAll("li.pv-entity__position-group-role-item")).map(stackedEl => {
							let stackedJob = { companyName, companyUrl }
							stackedJob.jobTitle = stackedEl.querySelector(".pv-entity__summary-info-v2 > h3 > span:last-of-type") ? stackedEl.querySelector(".pv-entity__summary-info-v2 > h3 > span:last-of-type").textContent.trim() : null
							stackedJob.dateRange = stackedEl.querySelector(".pv-entity__date-range > span:last-of-type") ? stackedEl.querySelector(".pv-entity__date-range > span:last-of-type").textContent.trim() : null
							stackedJob.location = stackedEl.querySelector(".pv-entity__location > span:last-of-type") ? stackedEl.querySelector(".pv-entity__location > span:last-of-type").textContent.trim() : null
							stackedJob.description = extractJobDescription(stackedEl)
							return stackedJob
						})
					}

					job.companyName = (el.querySelector(".pv-entity__secondary-title") ? el.querySelector(".pv-entity__secondary-title").textContent.trim() : null)
					job.companyUrl = (el.querySelector("a[data-control-name=\"background_details_company\"]") ? el.querySelector("a[data-control-name=\"background_details_company\"]").href : null)
					job.jobTitle = (el.querySelector("a[data-control-name=\"background_details_company\"] div.pv-entity__summary-info > h3") ? el.querySelector("a[data-control-name=\"background_details_company\"] div.pv-entity__summary-info > h3").textContent.trim() : null)
					job.dateRange = (el.querySelector(".pv-entity__date-range > span:nth-child(2)") ? el.querySelector(".pv-entity__date-range > span:nth-child(2)").textContent.trim() : null)
					job.location = (el.querySelector(".pv-entity__location > span:nth-child(2)") ? el.querySelector(".pv-entity__location > span:nth-child(2)").textContent.trim() : null)
					let description = null
					if (el.querySelector(".pv-entity__description")) {
						let seeMoreElement = el.querySelector(".lt-line-clamp__ellipsis")
						let seeLessElement = el.querySelector(".lt-line-clamp__less")
						seeMoreElement && seeMoreElement.parentNode.removeChild(seeMoreElement)
						seeLessElement && seeLessElement.parentNode.removeChild(seeLessElement)
						let cleanedHTML = el.querySelector(".pv-entity__description").innerHTML.replace(/(<\/?br>)/g, "\n")
						el.querySelector(".pv-entity__description").innerHTML = cleanedHTML
						description = el.querySelector(".pv-entity__description").textContent.trim()
					}
					job.description = description
					return job
				})
				infos.jobs = flatArray(infos.jobs, 2)
			}
			// Get all profile schools listed
			const schools = document.querySelectorAll(".pv-profile-section.education-section ul > li")
			if (schools) {
				infos.schools = getListInfos(schools, [
					{ key: "schoolUrl", attribute: "href", selector: "a.background_details_school" },
					{ key: "schoolUrl", attribute: "href", selector: "a[data-control-name=\"background_details_school\"]" }, // Issue #52
					{ key: "schoolName", attribute: "textContent", selector: ".pv-entity__school-name" },
					{ key: "degree", attribute: "textContent", selector: ".pv-entity__secondary-title.pv-entity__degree-name span.pv-entity__comma-item" },
					{ key: "degreeSpec", attribute: "textContent", selector: ".pv-entity__secondary-title.pv-entity__fos span.pv-entity__comma-item" },
					{ key: "dateRange", attribute: "textContent", selector: ".pv-entity__dates > span:nth-child(2)" },
					{ key: "description", attribute: "textContent", selector: ".pv-entity__description" },
				])
			}
			// Get all profile infos listed
			infos.details = getInfos([
				{ key: "linkedinProfile", attribute: "href", selector: ".pv-contact-info__contact-type.ci-vanity-url .pv-contact-info__contact-link" },
				{ key: "websites", attribute: "textContent", selector: "section.pv-contact-info__contact-type.ci-websites.pv-contact-info__list" },
				{ key: "twitter", attribute: "textContent", selector: "section.pv-contact-info__contact-type.ci-twitter .pv-contact-info__contact-link" },
				{ key: "phone", attribute: "href", selector: "section.pv-contact-info__contact-type.ci-phone .pv-contact-info__contact-link" },
				{ key: "mail", attribute: "textContent", selector: "section.pv-contact-info__contact-type.ci-email .pv-contact-info__contact-link" },
			])

			// Get all profile skills listed
			const skills = document.querySelectorAll("ul.pv-featured-skills-list > li")
			const _skills = document.querySelectorAll("ol.pv-skill-categories-section__top-skills > li, ol.pv-skill-category-list__skills_list > li")
			// Alternative selector for skill sections
			if (skills.length > 0) {
				infos.skills = getListInfos(skills, [
					{ key: "name", attribute: "textContent", selector: "span.pv-skill-entity__skill-name" },
					{ key: "endorsements", attribute: "textContent", selector: "span.pv-skill-entity__endorsement-count" },
				])
			// If the first selector failed, the script will try this selector
			} else if (_skills.length > 0) {
				// Special handlers for skills
				// Skills without endorsements use a different CSS selector
				infos.skills = Array.from(_skills).map(el => {
					let ret = {}
					if (el.querySelector(".pv-skill-category-entity__name span")) {
						ret.name = el.querySelector(".pv-skill-category-entity__name span").textContent.trim()
					} else if (el.querySelector(".pv-skill-category-entity__name")) {
						ret.name = el.querySelector(".pv-skill-category-entity__name").textContent.trim()
					} else {
						ret.name = ""
					}

					if (el.querySelector("span.pv-skill-category-entity__endorsement-count")) {
						ret.endorsements = el.querySelector("span.pv-skill-category-entity__endorsement-count").textContent.trim()
					} else {
						ret.endorsements = "0"
					}
					return ret
				})
			} else {
				infos.skills = []
			}
			// Delete tel: for the phone
			if (infos.details.phone) {
				infos.details.phone = infos.details.phone.replace("tel:", "")
			}
		}
		if (infos.general && infos.general.fullName && infos.general.hasAccount) {
			// Get the first name from the page (and the last name)
			if (infos.general.fullName && infos.general.hasAccount) {
				const nameTab = infos.general.fullName.split(" ")
				const length = nameTab.length
				let firstName = ""
				// In case of composed name
				for (let i = 0; i < length; i++) {
					firstName += nameTab.splice(0, 1) + " "
					if (infos.general.hasAccount.toLowerCase().indexOf(firstName.trim().toLowerCase()) >= 0) {
						// Stop when we have the right first name
						infos.general.firstName = firstName.trim()
						infos.general.lastName = nameTab.join(" ")
						break
					}
				}
			}
			// Delete this (only needed to determine the first name)
			delete infos.general.hasAccount
			if (!infos.general.firstName) { // if we didn't find anything, we split the full name in two parts to get the firstName
				const EMOJI_PATTERN = /\u{1F3F4}(?:\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0077}\u{E006C}\u{E0073}|\u{E0073}\u{E0063}\u{E0074})\u{E007F}|\u200D\u2620\uFE0F)|\u{1F469}\u200D\u{1F469}\u200D(?:\u{1F466}\u200D\u{1F466}|\u{1F467}\u200D[\u{1F466}\u{1F467}])|\u{1F468}(?:\u200D(?:\u2764\uFE0F\u200D(?:\u{1F48B}\u200D)?\u{1F468}|[\u{1F468}\u{1F469}]\u200D(?:\u{1F466}\u200D\u{1F466}|\u{1F467}\u200D[\u{1F466}\u{1F467}])|\u{1F466}\u200D\u{1F466}|\u{1F467}\u200D[\u{1F466}\u{1F467}]|[\u{1F33E}\u{1F373}\u{1F393}\u{1F3A4}\u{1F3A8}\u{1F3EB}\u{1F3ED}\u{1F4BB}\u{1F4BC}\u{1F527}\u{1F52C}\u{1F680}\u{1F692}\u{1F9B0}-\u{1F9B3}])|[\u{1F3FB}-\u{1F3FF}]\u200D[\u{1F33E}\u{1F373}\u{1F393}\u{1F3A4}\u{1F3A8}\u{1F3EB}\u{1F3ED}\u{1F4BB}\u{1F4BC}\u{1F527}\u{1F52C}\u{1F680}\u{1F692}\u{1F9B0}-\u{1F9B3}])|\u{1F469}\u200D(?:\u2764\uFE0F\u200D(?:\u{1F48B}\u200D[\u{1F468}\u{1F469}]|[\u{1F468}\u{1F469}])|[\u{1F33E}\u{1F373}\u{1F393}\u{1F3A4}\u{1F3A8}\u{1F3EB}\u{1F3ED}\u{1F4BB}\u{1F4BC}\u{1F527}\u{1F52C}\u{1F680}\u{1F692}\u{1F9B0}-\u{1F9B3}])|\u{1F469}\u200D\u{1F466}\u200D\u{1F466}|(?:\u{1F441}\uFE0F\u200D\u{1F5E8}|\u{1F469}[\u{1F3FB}-\u{1F3FF}]\u200D[\u2695\u2696\u2708]|\u{1F468}(?:[\u{1F3FB}-\u{1F3FF}]\u200D[\u2695\u2696\u2708]|\u200D[\u2695\u2696\u2708])|(?:[\u26F9\u{1F3CB}\u{1F3CC}\u{1F575}]\uFE0F|[\u{1F46F}\u{1F93C}\u{1F9DE}\u{1F9DF}])\u200D[\u2640\u2642]|[\u26F9\u{1F3CB}\u{1F3CC}\u{1F575}][\u{1F3FB}-\u{1F3FF}]\u200D[\u2640\u2642]|[\u{1F3C3}\u{1F3C4}\u{1F3CA}\u{1F46E}\u{1F471}\u{1F473}\u{1F477}\u{1F481}\u{1F482}\u{1F486}\u{1F487}\u{1F645}-\u{1F647}\u{1F64B}\u{1F64D}\u{1F64E}\u{1F6A3}\u{1F6B4}-\u{1F6B6}\u{1F926}\u{1F937}-\u{1F939}\u{1F93D}\u{1F93E}\u{1F9B8}\u{1F9B9}\u{1F9D6}-\u{1F9DD}](?:[\u{1F3FB}-\u{1F3FF}]\u200D[\u2640\u2642]|\u200D[\u2640\u2642])|\u{1F469}\u200D[\u2695\u2696\u2708])\uFE0F|\u{1F469}\u200D\u{1F467}\u200D[\u{1F466}\u{1F467}]|\u{1F469}\u200D\u{1F469}\u200D[\u{1F466}\u{1F467}]|\u{1F468}(?:\u200D(?:[\u{1F468}\u{1F469}]\u200D[\u{1F466}\u{1F467}]|[\u{1F466}\u{1F467}])|[\u{1F3FB}-\u{1F3FF}])|\u{1F3F3}\uFE0F\u200D\u{1F308}|\u{1F469}\u200D\u{1F467}|\u{1F469}[\u{1F3FB}-\u{1F3FF}]\u200D[\u{1F33E}\u{1F373}\u{1F393}\u{1F3A4}\u{1F3A8}\u{1F3EB}\u{1F3ED}\u{1F4BB}\u{1F4BC}\u{1F527}\u{1F52C}\u{1F680}\u{1F692}\u{1F9B0}-\u{1F9B3}]|\u{1F469}\u200D\u{1F466}|\u{1F1F6}\u{1F1E6}|\u{1F1FD}\u{1F1F0}|\u{1F1F4}\u{1F1F2}|\u{1F469}[\u{1F3FB}-\u{1F3FF}]|\u{1F1ED}[\u{1F1F0}\u{1F1F2}\u{1F1F3}\u{1F1F7}\u{1F1F9}\u{1F1FA}]|\u{1F1EC}[\u{1F1E6}\u{1F1E7}\u{1F1E9}-\u{1F1EE}\u{1F1F1}-\u{1F1F3}\u{1F1F5}-\u{1F1FA}\u{1F1FC}\u{1F1FE}]|\u{1F1EA}[\u{1F1E6}\u{1F1E8}\u{1F1EA}\u{1F1EC}\u{1F1ED}\u{1F1F7}-\u{1F1FA}]|\u{1F1E8}[\u{1F1E6}\u{1F1E8}\u{1F1E9}\u{1F1EB}-\u{1F1EE}\u{1F1F0}-\u{1F1F5}\u{1F1F7}\u{1F1FA}-\u{1F1FF}]|\u{1F1F2}[\u{1F1E6}\u{1F1E8}-\u{1F1ED}\u{1F1F0}-\u{1F1FF}]|\u{1F1F3}[\u{1F1E6}\u{1F1E8}\u{1F1EA}-\u{1F1EC}\u{1F1EE}\u{1F1F1}\u{1F1F4}\u{1F1F5}\u{1F1F7}\u{1F1FA}\u{1F1FF}]|\u{1F1FC}[\u{1F1EB}\u{1F1F8}]|\u{1F1FA}[\u{1F1E6}\u{1F1EC}\u{1F1F2}\u{1F1F3}\u{1F1F8}\u{1F1FE}\u{1F1FF}]|\u{1F1F0}[\u{1F1EA}\u{1F1EC}-\u{1F1EE}\u{1F1F2}\u{1F1F3}\u{1F1F5}\u{1F1F7}\u{1F1FC}\u{1F1FE}\u{1F1FF}]|\u{1F1EF}[\u{1F1EA}\u{1F1F2}\u{1F1F4}\u{1F1F5}]|\u{1F1F8}[\u{1F1E6}-\u{1F1EA}\u{1F1EC}-\u{1F1F4}\u{1F1F7}-\u{1F1F9}\u{1F1FB}\u{1F1FD}-\u{1F1FF}]|\u{1F1EE}[\u{1F1E8}-\u{1F1EA}\u{1F1F1}-\u{1F1F4}\u{1F1F6}-\u{1F1F9}]|\u{1F1FF}[\u{1F1E6}\u{1F1F2}\u{1F1FC}]|\u{1F1EB}[\u{1F1EE}-\u{1F1F0}\u{1F1F2}\u{1F1F4}\u{1F1F7}]|\u{1F1F5}[\u{1F1E6}\u{1F1EA}-\u{1F1ED}\u{1F1F0}-\u{1F1F3}\u{1F1F7}-\u{1F1F9}\u{1F1FC}\u{1F1FE}]|\u{1F1E9}[\u{1F1EA}\u{1F1EC}\u{1F1EF}\u{1F1F0}\u{1F1F2}\u{1F1F4}\u{1F1FF}]|\u{1F1F9}[\u{1F1E6}\u{1F1E8}\u{1F1E9}\u{1F1EB}-\u{1F1ED}\u{1F1EF}-\u{1F1F4}\u{1F1F7}\u{1F1F9}\u{1F1FB}\u{1F1FC}\u{1F1FF}]|\u{1F1E7}[\u{1F1E6}\u{1F1E7}\u{1F1E9}-\u{1F1EF}\u{1F1F1}-\u{1F1F4}\u{1F1F6}-\u{1F1F9}\u{1F1FB}\u{1F1FC}\u{1F1FE}\u{1F1FF}]|[#*0-9]\uFE0F\u20E3|\u{1F1F1}[\u{1F1E6}-\u{1F1E8}\u{1F1EE}\u{1F1F0}\u{1F1F7}-\u{1F1FB}\u{1F1FE}]|\u{1F1E6}[\u{1F1E8}-\u{1F1EC}\u{1F1EE}\u{1F1F1}\u{1F1F2}\u{1F1F4}\u{1F1F6}-\u{1F1FA}\u{1F1FC}\u{1F1FD}\u{1F1FF}]|\u{1F1F7}[\u{1F1EA}\u{1F1F4}\u{1F1F8}\u{1F1FA}\u{1F1FC}]|\u{1F1FB}[\u{1F1E6}\u{1F1E8}\u{1F1EA}\u{1F1EC}\u{1F1EE}\u{1F1F3}\u{1F1FA}]|\u{1F1FE}[\u{1F1EA}\u{1F1F9}]|[\u{1F3C3}\u{1F3C4}\u{1F3CA}\u{1F46E}\u{1F471}\u{1F473}\u{1F477}\u{1F481}\u{1F482}\u{1F486}\u{1F487}\u{1F645}-\u{1F647}\u{1F64B}\u{1F64D}\u{1F64E}\u{1F6A3}\u{1F6B4}-\u{1F6B6}\u{1F926}\u{1F937}-\u{1F939}\u{1F93D}\u{1F93E}\u{1F9B8}\u{1F9B9}\u{1F9D6}-\u{1F9DD}][\u{1F3FB}-\u{1F3FF}]|[\u26F9\u{1F3CB}\u{1F3CC}\u{1F575}][\u{1F3FB}-\u{1F3FF}]|[\u261D\u270A-\u270D\u{1F385}\u{1F3C2}\u{1F3C7}\u{1F442}\u{1F443}\u{1F446}-\u{1F450}\u{1F466}\u{1F467}\u{1F470}\u{1F472}\u{1F474}-\u{1F476}\u{1F478}\u{1F47C}\u{1F483}\u{1F485}\u{1F4AA}\u{1F574}\u{1F57A}\u{1F590}\u{1F595}\u{1F596}\u{1F64C}\u{1F64F}\u{1F6C0}\u{1F6CC}\u{1F918}-\u{1F91C}\u{1F91E}\u{1F91F}\u{1F930}-\u{1F936}\u{1F9B5}\u{1F9B6}\u{1F9D1}-\u{1F9D5}][\u{1F3FB}-\u{1F3FF}]|[\u261D\u26F9\u270A-\u270D\u{1F385}\u{1F3C2}-\u{1F3C4}\u{1F3C7}\u{1F3CA}-\u{1F3CC}\u{1F442}\u{1F443}\u{1F446}-\u{1F450}\u{1F466}-\u{1F469}\u{1F46E}\u{1F470}-\u{1F478}\u{1F47C}\u{1F481}-\u{1F483}\u{1F485}-\u{1F487}\u{1F4AA}\u{1F574}\u{1F575}\u{1F57A}\u{1F590}\u{1F595}\u{1F596}\u{1F645}-\u{1F647}\u{1F64B}-\u{1F64F}\u{1F6A3}\u{1F6B4}-\u{1F6B6}\u{1F6C0}\u{1F6CC}\u{1F918}-\u{1F91C}\u{1F91E}\u{1F91F}\u{1F926}\u{1F930}-\u{1F939}\u{1F93D}\u{1F93E}\u{1F9B5}\u{1F9B6}\u{1F9B8}\u{1F9B9}\u{1F9D1}-\u{1F9DD}][\u{1F3FB}-\u{1F3FF}]?|[\u231A\u231B\u23E9-\u23EC\u23F0\u23F3\u25FD\u25FE\u2614\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26FA\u26FD\u2705\u270A\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B\u2B1C\u2B50\u2B55\u{1F004}\u{1F0CF}\u{1F18E}\u{1F191}-\u{1F19A}\u{1F1E6}-\u{1F1FF}\u{1F201}\u{1F21A}\u{1F22F}\u{1F232}-\u{1F236}\u{1F238}-\u{1F23A}\u{1F250}\u{1F251}\u{1F300}-\u{1F320}\u{1F32D}-\u{1F335}\u{1F337}-\u{1F37C}\u{1F37E}-\u{1F393}\u{1F3A0}-\u{1F3CA}\u{1F3CF}-\u{1F3D3}\u{1F3E0}-\u{1F3F0}\u{1F3F4}\u{1F3F8}-\u{1F43E}\u{1F440}\u{1F442}-\u{1F4FC}\u{1F4FF}-\u{1F53D}\u{1F54B}-\u{1F54E}\u{1F550}-\u{1F567}\u{1F57A}\u{1F595}\u{1F596}\u{1F5A4}\u{1F5FB}-\u{1F64F}\u{1F680}-\u{1F6C5}\u{1F6CC}\u{1F6D0}-\u{1F6D2}\u{1F6EB}\u{1F6EC}\u{1F6F4}-\u{1F6F9}\u{1F910}-\u{1F93A}\u{1F93C}-\u{1F93E}\u{1F940}-\u{1F945}\u{1F947}-\u{1F970}\u{1F973}-\u{1F976}\u{1F97A}\u{1F97C}-\u{1F9A2}\u{1F9B0}-\u{1F9B9}\u{1F9C0}-\u{1F9C2}\u{1F9D0}-\u{1F9FF}]|[#*0-9\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u231A\u231B\u2328\u23CF\u23E9-\u23F3\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB-\u25FE\u2600-\u2604\u260E\u2611\u2614\u2615\u2618\u261D\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2640\u2642\u2648-\u2653\u265F\u2660\u2663\u2665\u2666\u2668\u267B\u267E\u267F\u2692-\u2697\u2699\u269B\u269C\u26A0\u26A1\u26AA\u26AB\u26B0\u26B1\u26BD\u26BE\u26C4\u26C5\u26C8\u26CE\u26CF\u26D1\u26D3\u26D4\u26E9\u26EA\u26F0-\u26F5\u26F7-\u26FA\u26FD\u2702\u2705\u2708-\u270D\u270F\u2712\u2714\u2716\u271D\u2721\u2728\u2733\u2734\u2744\u2747\u274C\u274E\u2753-\u2755\u2757\u2763\u2764\u2795-\u2797\u27A1\u27B0\u27BF\u2934\u2935\u2B05-\u2B07\u2B1B\u2B1C\u2B50\u2B55\u3030\u303D\u3297\u3299\u{1F004}\u{1F0CF}\u{1F170}\u{1F171}\u{1F17E}\u{1F17F}\u{1F18E}\u{1F191}-\u{1F19A}\u{1F1E6}-\u{1F1FF}\u{1F201}\u{1F202}\u{1F21A}\u{1F22F}\u{1F232}-\u{1F23A}\u{1F250}\u{1F251}\u{1F300}-\u{1F321}\u{1F324}-\u{1F393}\u{1F396}\u{1F397}\u{1F399}-\u{1F39B}\u{1F39E}-\u{1F3F0}\u{1F3F3}-\u{1F3F5}\u{1F3F7}-\u{1F4FD}\u{1F4FF}-\u{1F53D}\u{1F549}-\u{1F54E}\u{1F550}-\u{1F567}\u{1F56F}\u{1F570}\u{1F573}-\u{1F57A}\u{1F587}\u{1F58A}-\u{1F58D}\u{1F590}\u{1F595}\u{1F596}\u{1F5A4}\u{1F5A5}\u{1F5A8}\u{1F5B1}\u{1F5B2}\u{1F5BC}\u{1F5C2}-\u{1F5C4}\u{1F5D1}-\u{1F5D3}\u{1F5DC}-\u{1F5DE}\u{1F5E1}\u{1F5E3}\u{1F5E8}\u{1F5EF}\u{1F5F3}\u{1F5FA}-\u{1F64F}\u{1F680}-\u{1F6C5}\u{1F6CB}-\u{1F6D2}\u{1F6E0}-\u{1F6E5}\u{1F6E9}\u{1F6EB}\u{1F6EC}\u{1F6F0}\u{1F6F3}-\u{1F6F9}\u{1F910}-\u{1F93A}\u{1F93C}-\u{1F93E}\u{1F940}-\u{1F945}\u{1F947}-\u{1F970}\u{1F973}-\u{1F976}\u{1F97A}\u{1F97C}-\u{1F9A2}\u{1F9B0}-\u{1F9B9}\u{1F9C0}-\u{1F9C2}\u{1F9D0}-\u{1F9FF}]\uFE0F?/gu
				const cleanFullName = infos.general.fullName.replace(EMOJI_PATTERN, "").trim()
				let nameArray
				if (cleanFullName) {
					nameArray = cleanFullName.split(" ")
				} else {
					nameArray = infos.general.fullName.split(" ")
				}
				const firstName = nameArray.shift()
				const lastName = nameArray.join(" ")
				infos.general.firstName = firstName
				if (lastName) {
					infos.general.lastName = lastName
				}
			}
		}
	}
	callback(null, infos)
}

// Function to handle errors and execute all steps of the scraping of ONE profile
const scrapingProcess = async (tab, url, utils, buster, saveImg, takeScreenshot, takePartialScreenshot, fullLoad, silence) => {
	console.log("Starting scraping...")
	const initS = new Date()
	const [httpCode] = await tab.open(url)
	if (httpCode && httpCode !== 200 && httpCode !== 999) {
		throw `Expects HTTP code 200 when opening a LinkedIn profile but got ${httpCode}`
	}
	try {
		console.log("watu")

		await tab.waitUntilVisible("#profile-wrapper", 15000)
		if (!silence) {
			utils.log("Profile loaded.", "done")
		}
	} catch (error) {
		console.log("wou")
		throw ("Could not load the profile.")
	}
	if (fullLoad) {
		try {
			if (!silence) {
				utils.log("Scrolling to load all data of the profile...", "loading")
			}
			await fullScroll(tab)
		} catch (error) {
			if (!silence) {
				utils.log("Error during the scroll of the page.", "warning")
			}
		}
		try {
			await loadProfileSections(tab)
			if (!silence) {
				utils.log("All data loaded", "done")
			}
		} catch (error) {
			utils.log("Error during the loading of data.", "warning")
		}
		if (!silence) {
			utils.log("Scraping page...", "loading")
		}
	}
	console.log("Elapsed:T1", new Date() - initS, " ms.")
	let infos = await tab.evaluate(scrapeInfos, { url: await tab.getUrl() })
	try {
		if (infos.general.profileUrl.startsWith("https://www.linkedin.com/in/")) {
			let slug = infos.general.profileUrl.slice(28)
			slug = slug.slice(0, slug.indexOf("/"))
			if (saveImg) {
				if (infos.general.imgUrl) {
					const savedImg = await utils.saveImg(tab, infos.general.imgUrl, slug, "Error while saving profile picture.")
					if (savedImg) {
						infos.general.savedImg = savedImg
					}
				} else {
					utils.log("This profile has no profile picture to save.", "info")
				}
			}
			try {
				if (takeScreenshot) {
					infos.general.screenshot = await buster.save((await tab.screenshot(`screenshot_${slug}.jpeg`)))
				}
			} catch (err) {
				utils.log(`Error while saving screenshot: ${err}`, "error")
			}
			try {
				if (takePartialScreenshot) {
					infos.general.partialScreenshot = await buster.save((await tab.screenshot(`partial_screenshot_${slug}.jpeg`, { fullPage: false })))
				}
			} catch (err) {
				utils.log(`Error while saving partial screenshot: ${err}`, "error")
			}
		}
	} catch (err) {
		if (!silence) {
			utils.log(`Couldn't save picture :${err}`, "warning")
		}
	}

	const UI_SELECTORS = {
		trigger: "a[data-control-name=\"contact_see_more\"]",
		overlay: "artdeco-modal-overlay",
		modal: "artdeco-modal"
	}

	/**
	 * HACK: Tiny handler to fix scraping process with the LinkedIn UI
	 */
	if (await tab.isPresent(UI_SELECTORS.trigger)) {
		await tab.click(UI_SELECTORS.trigger)
		await tab.waitUntilVisible([ UI_SELECTORS.overlay, UI_SELECTORS.modal ], 20000, "and")
		infos.details = await tab.evaluate(getDetails)
		await tab.click(UI_SELECTORS.overlay)
	}

	infos.allSkills = (infos.skills) ? infos.skills.map(el => el.name ? el.name : "").join(", ") : ""
	console.log("Elapsed Final:", new Date() - initS, " ms.")
	return infos
}

// Function to format the infos for the csv file (less infos)
const craftCsvObject = infos => {
	let job = {}
	if (infos.jobs && infos.jobs[0]) {
		job = infos.jobs[0]
	}

	let job2 = {}
	if (infos.jobs && infos.jobs[1]) {
		job2 = infos.jobs[1]
	}

	let school = {}
	if (infos.schools && infos.schools[0]) {
		school = infos.schools[0]
	}

	let school2 = {}
	if (infos.schools && infos.schools[1]) {
		school2 = infos.schools[1]
	}

	/**
	 * We should know if infos object contains all fields in order to return the CSV formatted Object
	 * If the scraping process failed to retrieve some data, the function will fill gaps by a null value
	 */
	const hasDetails = infos.hasOwnProperty("details")
	const hasGeneral = infos.hasOwnProperty("general")
	const hasHunter = infos.hasOwnProperty("hunter")
	const hasDropcontact = infos.hasOwnProperty("dropcontact")
	const returnedObject = {
		linkedinProfile: (hasGeneral) ? (infos.general.profileUrl || null) : null,
		mail: (hasDetails) ? (infos.details.mail || null) : null,
		phoneNumber: (hasDetails) ? (infos.details.phone || null) : null,
		description: (hasGeneral) ? (infos.general.description || null) : null,
		imgUrl: (hasGeneral) ? (infos.general.imgUrl || null) : null,
		firstName: (hasGeneral) ? (infos.general.firstName || null) : null,
		lastName: (hasGeneral) ? (infos.general.lastName || null) : null,
		fullName: (hasGeneral) ? (infos.general.fullName || null) : null,
		subscribers: (hasGeneral) ? (infos.general.subscribers || null) : null,
		connectionDegree: (hasGeneral) ? (infos.general.connectionDegree || null) : null,
		vmid: (hasGeneral) ? (infos.general.vmid || null) : null,
		savedImg: (hasGeneral) ? (infos.general.savedImg || null) : null,
		screenshot: (hasGeneral) ? (infos.general.screenshot || null) : null,
		partialScreenshot: (hasGeneral) ? (infos.general.partialScreenshot || null) : null,
		linkedinRecruiterUrl: (hasGeneral) ? (infos.general.linkedinRecruiterUrl || null) : null,
		linkedinSalesNavigatorUrl: (hasGeneral) ? (infos.general.linkedinSalesNavigatorUrl || null) : null,
		connectionsUrl: (hasGeneral) ? (infos.general.connectionsUrl || null) : null,
		mutualConnectionsUrl: (hasGeneral) ? (infos.general.mutualConnectionsUrl || null) : null,
		company: job.companyName || null,
		companyUrl: job.companyUrl || null,
		jobTitle: job.jobTitle || null,
		jobDescription: job.description || null,
		location: job.location || null,
		jobDateRange: job.dateRange || null,
		company2: job2.companyName || null,
		companyUrl2: job2.companyUrl || null,
		jobTitle2: job2.jobTitle || null,
		jobDescription2: job2.description || null,
		location2: job2.location || null,
		jobDateRange2: job2.dateRange || null,
		school: school.schoolName || null,
		schoolUrl: school.schoolUrl || null,
		schoolDegree: school.degree || null,
		schoolDescription: school.description || null,
		schoolDegreeSpec: school.degreeSpec || null,
		schoolDateRange: school.dateRange || null,
		school2: school2.schoolName || null,
		schoolUrl2: school2.schoolUrl || null,
		schoolDegree2: school2.degree || null,
		schoolDescription2: school2.description || null,
		schoolDegreeSpec2: school2.degreeSpec || null,
		schoolDateRange2: school2.dateRange || null,
		mailFromDropcontact: (hasDetails) ? (infos.details.mailFromDropcontact || null) : null,
		mailQualificationFromDropContact: (hasDropcontact) ? (infos.dropcontact["email qualification"] || null) : null,
		naf5CodeFromDropContact: (hasDropcontact) ? (infos.dropcontact.naf5_code || null) : null,
		naf5DesFromDropContact: (hasDropcontact) ? (infos.dropcontact.naf5_des || null) : null,
		nbEmployeesFromDropContact: (hasDropcontact) ? (infos.dropcontact.nb_employees || null) : null,
		sirenFromDropContact: (hasDropcontact) ? (infos.dropcontact.siren || null) : null,
		siretFromDropContact: (hasDropcontact) ? (infos.dropcontact.siret || null) : null,
		siretAddressFromDropContact: (hasDropcontact) ? (infos.dropcontact.siret_address || null) : null,
		siretZipFromDropContact: (hasDropcontact) ? (infos.dropcontact.siret_zip || null) : null,
		vatFromDropContact: (hasDropcontact) ? (infos.dropcontact.vat || null) : null,
		websiteFromDropContact: (hasDropcontact) ? (infos.dropcontact.website || null) : null,
		facebookFromDropContact: (hasDropcontact) ? (infos.dropcontact.facebook || null) : null,
		googleplusFromDropContact: (hasDropcontact) ? (infos.dropcontact.googleplus || null) : null,
		githubFromDropContact: (hasDropcontact) ? (infos.dropcontact.github || null) : null,
		generate_idFromDropContact: (hasDropcontact) ? (infos.dropcontact.generate_id || null) : null,
		mailFromHunter: (hasDetails) ? (infos.details.mailFromHunter || null) : null,
		scoreFromHunter: (hasHunter) ? (infos.hunter.score || null) : null,
		positionFromHunter: (hasHunter) ? (infos.hunter.position || null) : null,
		twitterFromHunter: (hasHunter) ? (infos.hunter.twitter || null) : null,
		phoneNumberFromHunter: (hasHunter) ? (infos.hunter.phone_number || null) : null,
		twitter: (hasDetails) ? (infos.details.twitter || null) : null,
		connectedOn: (hasDetails) ? (infos.details.connectedOn || null) : null,
		website: (hasDetails) ? (infos.details.website || null) : null,
		facebookUrl: (hasDetails) ? (infos.details.facebook || null) : null,
		birthday: (hasDetails) ? (infos.details.birthday || null) : null,
		companyWebsite: (hasDetails) ? (infos.details.companyWebsite || null) : null,
		skill1: (infos.skills && infos.skills[0]) ? infos.skills[0].name : null,
		skill2: (infos.skills && infos.skills[1]) ? infos.skills[1].name : null,
		skill3: (infos.skills && infos.skills[2]) ? infos.skills[2].name : null,
		allSkills: (infos.allSkills) ? infos.allSkills : null
	}
	for (const property in returnedObject) {
		if (!returnedObject[property]) {
			delete returnedObject[property]
		}
	}
	return returnedObject
}

/**
 * CSV output description
 */
const defaultCsvResult = {
	linkedinProfile: null,
	description: null,
	imgUrl: null,
	firstName: null,
	lastName: null,
	fullName: null,
	subscribers: null,
	connectionDegree: null,
	vmid: null,
	savedImg: null,
	screenshot: null,
	partialScreenshot: null,
	company: null,
	companyUrl: null,
	jobTitle:  null,
	jobDescription: null,
	location: null,
	jobDateRange: null,
	company2: null,
	companyUrl2: null,
	jobTitle2: null,
	jobDescription2: null,
	location2: null,
	jobDateRange2: null,
	school: null,
	schoolUrl: null,
	schoolDegree: null,
	schoolDescription: null,
	schoolDegreeSpec: null,
	schoolDateRange: null,
	school2: null,
	schoolUrl2: null,
	schoolDegree2: null,
	schoolDescription2: null,
	schoolDegreeSpec2: null,
	schoolDateRange2: null,
	mail: null,
	mailFromHunter: null,
	scoreFromHunter: null,
	positionFromHunter:  null,
	twitterFromHunter: null,
	phoneNumberFromHunter:  null,
	mailFromDropcontact: null,
	mailQualificationFromDropContact: null,
	naf5CodeFromDropContact: null,
	naf5DesFromDropContact: null,
	nbEmployeesFromDropContact: null,
	sirenFromDropContact: null,
	siretFromDropContact: null,
	siretAddressFromDropContact: null,
	siretZipFromDropContact: null,
	vatFromDropContact: null,
	websiteFromDropContact: null,
	phoneNumber: null,
	twitter: null,
	companyWebsite: null,
	skill1:  null,
	skill2: null,
	skill3:  null,
	allSkills: null
}

/**
 * @description Function used to scrape the company website from it own LinkedIn company page
 * @throws if there were an error during the scraping process
 * @param {Object} tab - Nick.js tab
 * @param {String} url - LinkedIn company URL
 * @return {Promise<String>} Website company
 */
const getCompanyWebsite = async (tab, url, utils) => {
	try {
		const [httpCode] = await tab.open(url)
		if (httpCode === 404) {
			utils.log(`Can't open the LinkedIn company URL: ${url}`, "warning")
			return null
		}
		await tab.waitUntilVisible(".org-top-card-module__container", 15000)
		return await tab.evaluate((arg, cb) => {
			cb(null, document.querySelector(".org-about-company-module__company-page-url a").href)
		})
	} catch (err) {
		// utils.log(`${err.message || err}\n${err.stack || ""}`, "warning")
		return null
	}
}

/**
 * @class {Scraping} LinkedInScraper
 * @classdesc Tiny class used to scrape data on a LinkedIn profile
 */
class LinkedInScraper {
	/**
	 * @constructor
	 * @param {StoreUtilities} utils -- StoreUtilities instance}
	 * @param {String} [hunterApiKey] -- Hunter API key}
	 * @param {Object} [nick] -- Nickjs instance}
	 * @param {Object} [buster] -- buster instance}
	 * @param {String} [dropcontactApiKey] -- Dropcontact API key}
	 * @param {String} [emailChooser] -- Email discovery service used}
	 */
	constructor(utils, hunterApiKey = null, nick = null, buster = null, dropcontactApiKey = null, emailChooser = null) {
		this.utils = utils
		this.hunter = null
		this.nick = nick
		this.buster = buster
		if (emailChooser === "phantombuster") {
			require("coffee-script/register")
			this.phantombusterMail = new (require("./lib-DiscoverMail"))(this.buster.apiKey)
		}
		this.emailChooser = emailChooser
		if ((typeof(hunterApiKey) === "string") && (hunterApiKey.trim().length > 0)) {
			require("coffee-script/register")
			this.hunter = new (require("./lib-Hunter"))(hunterApiKey.trim())
		}
		if ((typeof(dropcontactApiKey) === "string") && (dropcontactApiKey.trim().length > 0)) {
			require("coffee-script/register")
			this.dropcontact = new (require("./lib-Dropcontact-DEV"))(dropcontactApiKey.trim())
		}
	}

	/**
	 * @static
	 * @description Method returning all CSV fields name
	 * @return {Array<String>}
	 */
	static csvFields() {
		return Object.keys(defaultCsvResult)
	}

	/**
	 * @async
	 * @description Profile scraper Method
	 * if HunterApiKey was passed to the constructor, this method will also look for professional email
	 * @param {Tab} tab -- Nick tab logged as a LinkedIn user}
	 * @param {String} url -- LinkedIn Profile URL}
	 * @param {Boolean} saveImg -- if true, save the profile picture as a jpeg}
	 * @param {Boolean} takeScreenshot -- if true, take a screenshot of the profile}
	 * @param {Boolean} takePartialScreenshot -- if true, take a partial screenshot of the profile}
	 * @return {Promise<Object>} JSON and CSV formatted result
	 */
	async scrapeProfile(tab, url = null, saveImg, takeScreenshot, takePartialScreenshot, fullLoad = true, silence) {
		let result = {}
		let csvResult = {}
		try {
			result = await scrapingProcess(tab, url, this.utils, this.buster, saveImg, takeScreenshot, takePartialScreenshot, fullLoad, silence)
			/**
			 * If the linkedIn profile is not fill during the scraping
			 * the lib will automatically set the current URL used in the browser
			 */
			const currentUrl = await tab.getUrl()
			if (!result.details.linkedinProfile) {
				result.details.linkedinProfile = currentUrl
			}
			if (!silence) {
				this.utils.log(`${currentUrl} successfully scraped.`, "done")
			}
		} catch (err) {
			result.details = {}
			result.jobs = []
			result.details["linkedinProfile"] = url
			if (!silence) {
				this.utils.log(`Could not scrape ${url} because: ${err}`, "error")
			}
			if (err.message && err.message.includes("ERR_TOO_MANY_REDIRECTS")) {
				result.error = "ERR_TOO_MANY_REDIRECTS"
			}
		}
		if ((this.hunter || this.dropcontact || this.phantombusterMail) && result.jobs.length > 0) {
			let init
			const timeLeft = await this.utils.checkTimeLeft()
			if (!timeLeft.timeLeft) {
				this.utils.log(timeLeft.message, "warning")
			} else {
				try {
					let servicesUsed
					if (this.hunter) {
						servicesUsed = "Hunter"
					}
					if (this.dropcontact) {
						servicesUsed = "Dropcontact"
					}
					if (this.phantombusterMail) {
						servicesUsed = "Phantombuser via Dropcontact"
					}
					let companyUrl = null
					if (this.nick) {
						const companyTab = await this.nick.newTab()
						companyUrl = await getCompanyWebsite(companyTab, result.jobs[0].companyUrl, this.utils)
						await companyTab.close()
						result.details.companyWebsite = companyUrl || ""
					}
					this.utils.log(`Searching for emails with ${servicesUsed}...`, "loading")
					const mailPayload = {}
					if (result.general.firstName && result.general.lastName) {
						mailPayload.first_name = result.general.firstName
						mailPayload.last_name = result.general.lastName
					} else {
						mailPayload.full_name = result.general.fullName
					}
					if (!companyUrl) {
						mailPayload.company = result.jobs[0].companyName
					} else {
						mailPayload.domain = companyUrl
					}
					if (this.hunter) {
						const hunterSearch = await this.hunter.find(mailPayload)
						this.utils.log(`Hunter found ${hunterSearch.email || "nothing"} for ${result.general.fullName} working at ${companyUrl || result.jobs[0].companyName}`, "info")
						result.details.mailFromHunter = hunterSearch.email
						result.hunter = Object.assign({}, hunterSearch)
					}
					if (this.dropcontact) {
						mailPayload.company = result.jobs[0].companyName
						mailPayload.siren = true
						init = new Date()
						const dropcontactSearch = await this.dropcontact.clean(mailPayload)
						console.log("hundropcontactSearchtS", dropcontactSearch)
						this.utils.log(`Dropcontact found ${dropcontactSearch.email || "nothing"} for ${result.general.fullName} working at ${result.jobs[0].companyName || companyUrl }`, "info")
						result.details.mailFromDropcontact = dropcontactSearch.email
						result.dropcontact = Object.assign({}, dropcontactSearch)
					}
					if (this.phantombusterMail) {
						mailPayload.company = result.jobs[0].companyName
						mailPayload.siren = true
						init = new Date()
						console.log("mailPayload", mailPayload)
						const dropcontactSearch = await this.phantombusterMail.find(mailPayload)
						const foundData = dropcontactSearch.data
						console.log("dropcontactSearch", dropcontactSearch)
						this.utils.log(`Phantombuster via Dropcontact found ${foundData.email || "nothing"} for ${result.general.fullName} working at ${result.jobs[0].companyName || companyUrl }`, "info")
						result.details.mailFromDropcontact = foundData.email
						result.dropcontact = Object.assign({}, foundData)
					}
				} catch (err) {
					this.utils.log(err.toString(), "error")
					result.details.mailFromHunter = ""
					result.details.companyWebsite = ""
				}
				console.log("Elapsed:", new Date() - init, " ms.")

			}
		}
		csvResult = craftCsvObject(result)
		return { csv: csvResult, json: result }
	}

	/**
	 * @async
	 * @description Profile visitor Method
	 * this method will open, load all section from a given LinkedIn profile URL
	 * @param {Tab} tab - Nick.js tab, with a LinkedIn session }
	 * @param {String} url - LinkedIn Profile URL }
	 * @param {Boolean} [verbose] - set this function quiet or not (default: print only errors)
	 * @return {Promise<void>} no data returned
	 */
	async visitProfile(tab, url, verbose = false) {
		const [httpCode] = await tab.open(url)
		if (httpCode !== 200 && httpCode) {
			throw `Expects HTTP code 200 when opening a LinkedIn profile but got ${httpCode}`
		}
		try {
			/**
			 * Using 7500ms timeout to make sure that the page is loaded
			 */
			await tab.waitUntilVisible("#profile-wrapper", 15000)
			verbose && this.utils.log("Profile loaded.", "done")
		} catch (error) {
			throw ("Could not load the profile.")
		}
		try {
			verbose && this.utils.log("Scrolling to load all data of the profile...", "loading")
			await fullScroll(tab)
		} catch (error) {
			this.utils.log("Error during the scroll of the page.", "warning")
		}
		try {
			await loadProfileSections(tab)
			verbose && this.utils.log("All data loaded", "info")
		} catch (error) {
			this.utils.log("Error during the loading of data.", "warning")
		}
		verbose && this.utils.log("Profile visited", "done")
	}

	// converts a Sales Navigator profile to a classic LinkedIn profile without getting its slug 
	salesNavigatorUrlCleaner(url, silence) {
		if (url.startsWith("www")) {
			url = `https://${url}`
		}
		try {
			let urlObject = new URL(url)
		if (urlObject.pathname.startsWith("/sales/profile") || urlObject.pathname.startsWith("/sales/people")) { // Sales Navigator link
			if (urlObject.pathname.startsWith("/sales/profile/")) { // converting '/sales/profile' to '/sales/people
				url = "https://linkedin.com/sales/people" + urlObject.pathname.slice(14)
				urlObject = new URL(url)
			}
			let path = urlObject.pathname
			path = path.slice(14)
			const id = path.slice(0, path.indexOf(","))
			url = `https://linkedin.com/in/${id}`
			if (!silence) {
				this.utils.log(`Converting Sales Navigator URL to ${url}`, "info")
			}
		}
		} catch (err) {
			//
		}
		return url
	}


	// converts a Sales Navigator profile to a classic LinkedIn profile while getting its slug (opening the page)
	async salesNavigatorUrlConverter(url) {
		let newUrl
		let salesProfile
		if (url && url.includes("/sales/profile/")) {
			salesProfile = true
			newUrl = url
		} else {
			newUrl = this.salesNavigatorUrlCleaner(url, true)
		}
		if (salesProfile || newUrl !== url) {
			const tab = await this.nick.newTab()
			try {
				await tab.open(newUrl)
				await tab.wait(2000)
				try {
					let location = await tab.getUrl()
					if (location !== newUrl) {
						if (location === "https://www.linkedin.com/m/login/" || location === "chrome-error://chromewebdata/") {
							this.utils.log(`Can't convert ${url}: Disconnected by LinkedIn`, "warning")
							await tab.close()
							return newUrl
						}
						if (location === "https://www.linkedin.com/feed/") {
							this.utils.log(`Can't convert ${url}: Redirected to home page`, "warning")
							await tab.close()
							return newUrl
						}
						if (salesProfile && location.startsWith("https://www.linkedin.com/sales/people/")) {
							location = await this.salesNavigatorUrlConverter(location)
						} else {
							this.utils.log(`Converting ${url} to ${location}`, "info")
						}
						await tab.close()
						return location
					} else {
						await tab.wait(10000)
						location = await tab.getUrl()
						if (location === "https://www.linkedin.com/m/login/" || location === "chrome-error://chromewebdata/") {
							this.utils.log(`Can't convert ${url}: Disconnected by LinkedIn`, "warning")
							await tab.close()
							return newUrl
						}
						this.utils.log(`Converting ${url} to ${location}`, "info")
						await tab.close()
						return location
					}
				} catch (err) {
					this.utils.log("Error accessing current location", "warning")
				}
			} catch (err) {
				this.utils.log(`Could not open ${url}, ${err}`, "error")
			}
			await tab.close()
		}
		return newUrl
	}
}

module.exports = LinkedInScraper
