import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: true,
  });
  // US-78: Express 5 cambió el parser de query strings por defecto de `qs`
  // ('extended') a `node:querystring` ('simple'), que no entiende corchetes:
  // `?limit[]=2` o `?search[name]=x` dejaban de llegar como array/objeto y
  // cambiaban la respuesta. 'extended' devuelve el comportamiento de Express 4.
  app.set('query parser', 'extended');
  // US-64: el admin manda el id desnudo (`1`) a POST /messages/seen/:id y el
  // parser JSON estricto de Nest lo rechaza con 400. Este parser no estricto
  // va antes y solo en esa ruta; el estricto ve el cuerpo ya leído y no hace
  // nada. Envuelto en una función anónima a propósito: Nest omite su propio
  // `jsonParser` si encuentra en la pila otra capa con ese nombre, y entonces
  // ninguna otra ruta leería JSON.
  const seenBodyParser = json({ strict: false });
  app.use(
    '/api/messages/seen',
    (req: Request, res: Response, next: NextFunction) =>
      seenBodyParser(req, res, next),
  );
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe());
  const config = new DocumentBuilder()
    .setTitle('Marvel')
    .setDescription('Marvel Mock API')
    .setVersion('1.0')
    .addTag('marvel')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
  const PORT = process.env.PORT || 5000;
  await app.listen(PORT);
  console.log(`Application is running on: ${await app.getUrl()}/api`);
}
bootstrap();
