import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const port = Number(process.env.SERVER_PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
