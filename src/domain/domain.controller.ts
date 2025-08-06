import { Controller, Get, Query } from '@nestjs/common';
import { DomainService } from './domain.service';

@Controller('consulta')
export class DomainController {
  constructor(private readonly domainService: DomainService) {}

  @Get()
  async consultarDominio(@Query('dominio') dominio: string) {
    return this.domainService.getDomainInfo(dominio);
  }
}