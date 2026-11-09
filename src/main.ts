import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Validation globale : rejette les champs non déclarés dans les DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Documentation Swagger
  const config = new DocumentBuilder()
    .setTitle('Shop API - TP NestJS')
    .setDescription('Categories, produits, clients et commandes')
    .setVersion('1.0')
    .build();

  SwaggerModule.setup('api', app, () => SwaggerModule.createDocument(app, config));

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}

void bootstrap();
