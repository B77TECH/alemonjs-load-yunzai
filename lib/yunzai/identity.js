//#region src/yunzai/identity.ts
/** Keep cross-platform IDs intact, including leading zeroes and large integers. */
function getCrossPlatformGroupId(spaceId, isPrivate) {
	return isPrivate ? 0 : String(spaceId ?? "");
}

//#endregion
export { getCrossPlatformGroupId };