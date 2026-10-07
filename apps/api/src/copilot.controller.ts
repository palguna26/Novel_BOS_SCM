import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth';
import { CopilotService } from './copilot.service';

@Controller('api/copilot')
@UseGuards(AuthGuard)
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  @Post('ask')
  ask(@Req() req: any, @Body() body: any) {
    return this.copilot.ask(req.user, body);
  }
}
