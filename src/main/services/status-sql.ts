import { STATUS_ID } from '../../shared/api'

/** A SQL list of status ids for IN (...): ids are checked to be plain letters, digits, _ and - */
export const statusList = (ids: string[]): string => {
  const safe = ids.filter((id) => STATUS_ID.test(id))
  return safe.length ? safe.map((id) => `'${id}'`).join(', ') : "''"
}
