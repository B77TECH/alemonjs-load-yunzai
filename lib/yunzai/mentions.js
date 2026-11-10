//#region src/yunzai/mentions.ts
function identityKeys(user) {
	return [
		user?.UserId,
		user?.SourceUserId,
		user?.MemberId,
		user?.id,
		user?.member_openid
	].filter((value) => value !== null && value !== void 0 && value !== "").map(String);
}
function isSelfMention(user) {
	return user?.bot === true && user?.is_you === true;
}
function isAllMention(user) {
	return user?.scope === "all" || user?.UserId === "all" || user?.UserId === "everyone";
}
/** Prefer scoped AlemonJS identities; raw QQ metadata supplies self/all flags. */
function extractMentionInfo(event) {
	const raw = Array.isArray(event?.value?.mentions) ? event.value.mentions : [];
	const standard = Array.isArray(event?.MessageMentions) ? event.MessageMentions : [];
	const atUsers = [];
	const consumed = /* @__PURE__ */ new Set();
	const append = (user, metadata = user, standardized = false) => {
		const isAll = isAllMention(user) || isAllMention(metadata);
		const id = standardized ? user?.UserId : user?.member_openid ?? user?.id;
		if (!isAll && (id === null || id === void 0 || id === "")) return false;
		atUsers.push({
			userId: isAll ? "all" : String(id),
			userName: user?.UserName ?? user?.username ?? "",
			...isSelfMention(metadata) ? { isSelf: true } : {},
			...isAll ? { isAll: true } : {}
		});
		return true;
	};
	for (const user of standard) {
		const keys = identityKeys(user);
		const metadata = raw.find((item) => identityKeys(item).some((key) => keys.includes(key)));
		if (append(user, metadata, true) && metadata) consumed.add(metadata);
	}
	const hasStandardUsers = atUsers.length > 0;
	for (const user of raw) if (!consumed.has(user) && (!hasStandardUsers || isSelfMention(user) || isAllMention(user))) append(user);
	if (Array.isArray(event?.value?.message)) {
		const useSegmentUsers = atUsers.length === 0;
		for (const segment of event.value.message) {
			if (segment?.type !== "at") continue;
			const id = segment.data?.qq ?? segment.qq;
			if (id === null || id === void 0 || id === "") continue;
			if (!useSegmentUsers && id !== "all") continue;
			if (id === "all" && atUsers.some((user) => user.isAll || user.userId === "all")) continue;
			atUsers.push({
				userId: String(id),
				userName: segment.data?.text ?? segment.text ?? "",
				...id === "all" ? { isAll: true } : {}
			});
		}
	}
	return {
		atUsers,
		isAtMe: event?.IsAtMe === true || event?.isAtMe === true || raw.some(isSelfMention) || atUsers.some((user) => user.isSelf === true)
	};
}
/** Cross-platform IDs are opaque strings, never decimal prefixes. */
function buildMentionSegments(users = [], selfId, isAtMe = false) {
	const segments = (Array.isArray(users) ? users : []).filter((user) => user?.userId !== null && user?.userId !== void 0 && user.userId !== "").map((user) => ({
		type: "at",
		qq: user.isAll || user.userId === "all" ? "all" : user.isSelf ? selfId : String(user.userId),
		text: user.userName ?? ""
	}));
	if (isAtMe && !segments.some((segment) => String(segment.qq) === String(selfId))) segments.unshift({
		type: "at",
		qq: selfId,
		text: ""
	});
	return segments;
}

//#endregion
export { buildMentionSegments, extractMentionInfo };