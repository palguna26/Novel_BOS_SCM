import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from './auth';
import { DocumentService } from './document.service';

const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;

@Controller('api/documents')
@UseGuards(AuthGuard)
export class DocumentController {
  constructor(private docs: DocumentService) {}

  @Post('extract')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_SIZE, fieldSize: MAX_DOCUMENT_SIZE } }))
  async extract(@UploadedFile() file: Express.Multer.File, @Body('extractedText') extractedText: string | undefined, @Req() req: any, @Headers('idempotency-key') key?: string) {
    if (!file) throw new BadRequestException('File is required.');
    const result = await this.docs.saveAndExtract(file.originalname, file.buffer, req.user, key, file.mimetype, extractedText);
    return { ...result, userId: req.user.id };
  }

  @Get(':id/url')
  signedUrl(@Param('id') id: string, @Req() req: any) {
    return this.docs.signedUrl(id, req.user);
  }
}
