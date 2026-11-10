/** OneBot uses numeric group IDs; other platforms may use opaque strings. */
export type GroupId = number | string;

/** Keep cross-platform IDs intact, including leading zeroes and large integers. */
export function getCrossPlatformGroupId(spaceId: unknown, isPrivate: boolean): GroupId {
  return isPrivate ? 0 : String(spaceId ?? '');
}
