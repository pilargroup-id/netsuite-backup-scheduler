import { BigQuery } from '@google-cloud/bigquery';
export const PROJECT = 'even-gearbox-255203';
export const DATASET = 'netsuite_backup';
export const LOCATION = 'asia-southeast1';
export const bq = new BigQuery({ projectId: PROJECT });
export const dataset = bq.dataset(DATASET);
export const T = name => `\`${PROJECT}.${DATASET}.${name}\``;
export async function query(sql, params = {}) {
  const [rows] = await bq.query({ query: sql, params, location: LOCATION });
  return rows;
}
