import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

@Catch(HttpException)
export class IntegrationExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const request = host.switchToHttp().getRequest();
    const requestId = String(request.headers['x-request-id'] || randomUUID());
    const status = exception.getStatus();
    const body: any = exception.getResponse();
    const message = typeof body === 'string' ? body : body?.message || exception.message;
    const code = typeof body === 'object' && body?.code ? body.code : status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : 'INTEGRATION_REQUEST_FAILED';
    response.status(status).json({ error: { code, message: Array.isArray(message) ? message.join('; ') : message, requestId } });
  }
}
