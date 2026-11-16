/** @format */

import { XernerxShardClient } from '@xernerx/framework';
import { XernerxStats } from '@xernerx/stats';
import { getApiUrl } from './lib/endpoints.js';

process.env.API_URL = getApiUrl();

export class ShardClient extends XernerxShardClient {
	constructor() {
		const totalShardsEnv = Number(process.env.TOTAL_SHARDS);
		const shardsPerClustersEnv = Number(process.env.SHARDS_PER_CLUSTER);

		super({
			file: 'dist/main.js',
			token: process.env.TOKEN as string,
			totalShards: Number.isFinite(totalShardsEnv) && totalShardsEnv > 0 ? totalShardsEnv : 'auto',
			...(Number.isFinite(shardsPerClustersEnv) && shardsPerClustersEnv > 0 ? { shardsPerClusters: shardsPerClustersEnv } : {}),
		});

		const apiToken = (process.env.API_TOKEN || '').trim();
		if (apiToken) {
			const stats = new XernerxStats(this, {
				token: apiToken,
				url: getApiUrl(),
			});
			void stats.main(this);
		}
	}
}

export const shard = new ShardClient();
