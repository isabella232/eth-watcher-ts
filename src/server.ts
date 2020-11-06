import { createServer } from 'http';
import Store from './store';
import { createConnection, getConnectionOptions } from 'typeorm';
import postgraphile from 'postgraphile';

import App from './app';
import env from './env';
import GraphqlService from './services/graphqlService';

(async (): Promise<void> => {
	const connectionOptions = await getConnectionOptions();
	createConnection(connectionOptions).then(async () => {
		const app = new App();

		Store.init();

		const graphqlService = new GraphqlService();

		if (env.ENABLE_EVENT_WATCHER) {
			graphqlService.subscriptionReceiptCids(); // async
		} else {
			console.info('Event watcher is not enabled');
		}

		if (env.ENABLE_HEADER_WATCHER && env.ENABLE_EVENT_WATCHER) {
			console.log('Header watcher will work via Event watcher');
		} else if (env.ENABLE_HEADER_WATCHER && !env.ENABLE_EVENT_WATCHER) {
			graphqlService.subscriptionHeaderCids(); // async
		} else {
			console.info('Header watcher is not enabled');
		}

		if (env.HTTP_ENABLE) {
			createServer(app.app).listen(env.HTTP_PORT, env.HTTP_ADDR,() =>
				console.info(`Http server running on port ${env.HTTP_ADDR}:${env.HTTP_PORT}`)
			);
		} else {
			console.info('Http server will be not run');
		}
	}).catch((error) => console.log('Error: ', error));

	if (env.GRAPHQL_SERVER_ENABLE) {
		createServer(
			postgraphile(
				`postgres://${env.DATABASE_USER}:${env.DATABASE_PASSWORD}@${env.DATABASE_HOSTNAME}:${env.DATABASE_PORT}/${env.DATABASE_NAME}`,
				[
					'contract',
					'data',
				],
				{
					watchPg: true,
					graphiql: true,
					enhanceGraphiql: true,
				}
			)
		)
		.listen(env.GRAPHQL_SERVER_PORT, env.GRAPHQL_SERVER_ADDR, () =>
			console.info(`Postgraphile server running on port ${env.GRAPHQL_SERVER_ADDR}:${env.GRAPHQL_SERVER_PORT}`)
		);
	} else {
		console.info('Postgraphile server will be not run');
	}
})();
