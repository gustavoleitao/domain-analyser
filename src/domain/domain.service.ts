// src/domain/domain.service.ts

const isRender = !!process.env.RENDER; // variável automática no Render

import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as dns from 'dns/promises';
import chromium from 'chrome-aws-lambda';
const puppeteerLib = isRender ? require('puppeteer-core') : require('puppeteer');
import * as dotenv from 'dotenv';
dotenv.config();



@Injectable()
export class DomainService {

  private whoisApiKey = process.env.WHOIS_API_KEY;

  private REGISTRAR_CONTACTS: Record<string, {
    site: string;
    email: string;
    telefone?: string;
  }> = {
      'GoDaddy.com, LLC': {
        site: 'https://www.godaddy.com',
        email: 'abuse@godaddy.com',
        telefone: '+1-480-505-8800',
      },
      'Namecheap, Inc.': {
        site: 'https://www.namecheap.com',
        email: 'abuse@namecheap.com',
      },
      'Tucows Domains Inc.': {
        site: 'https://www.tucowsdomains.com',
        email: 'compliance@tucows.com',
      },
      'Google LLC': {
        site: 'https://domains.google',
        email: 'support@domains.google',
      },
      'Amazon Registrar, Inc.': {
        site: 'https://registrar.amazon.com',
        email: 'registrar-abuse@amazon.com',
      },
      'HostGator.com LLC': {
        site: 'https://www.hostgator.com',
        email: 'abuse@hostgator.com',
      },
      'PDR Ltd. d/b/a PublicDomainRegistry.com': {
        site: 'https://publicdomainregistry.com',
        email: 'abuse-contact@publicdomainregistry.com',
      },
      'Wild West Domains, LLC': {
        site: 'https://www.wildwestdomains.com',
        email: 'abuse@wildwestdomains.com',
      },
      'eNom, LLC': {
        site: 'https://www.enom.com',
        email: 'abuse@enom.com',
      },
      'Gandi SAS': {
        site: 'https://www.gandi.net',
        email: 'abuse@gandi.net',
      },
      'OVH SAS': {
        site: 'https://www.ovh.com',
        email: 'abuse@ovh.net',
      },
      'Registro.br': {
        site: 'https://registro.br',
        email: 'hostmaster@registro.br',
        telefone: '+55 11 5509-3500',
      },
    };

  async getRegistroBrInfoComPuppeteer(domain: string) {
    const url = `https://registro.br/tecnologia/ferramentas/whois/?search=${domain}`;

    const browser = await puppeteerLib.launch({
      headless: true,
      ...(isRender
        ? {
          args: chromium.args,
          executablePath: await chromium.executablePath,
        }
        : {}),
    });

    const page = await browser.newPage();

    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.whois-response.active', { timeout: 10000 });

    const result = await page.evaluate(() => {
      const getFieldValue = (label: string): string | null => {
        const rows = Array.from(document.querySelectorAll('.whois-content table tr'));
        for (const row of rows) {
          const th = row.querySelector('th');
          const td = row.querySelector('td');
          if (th && td && th.textContent?.trim() === label) {
            return td.textContent?.trim() || null;
          }
        }
        return null;
      };

      const getMultipleText = (selector: string) => {
        return Array.from(document.querySelectorAll(selector)).map((el) => el.textContent?.trim());
      };

      return {
        titular: getFieldValue('Titular'),
        documento: getFieldValue('Documento'),
        responsavel: getFieldValue('Responsável'),
        pais: getFieldValue('País'),
        contatoTitular: getFieldValue('Contato do Titular'),
        contatoTecnico: getFieldValue('Contato Técnico'),
        dns: getMultipleText('.cell-nameservers .sub-cell'),
        criadoEm: getFieldValue('Criado'),
        expiraEm: getFieldValue('Expiração'),
        alteradoEm: getFieldValue('Alterado'),
        status: getFieldValue('Status'),
        emailTitular: (() => {
          const emailCell = document.querySelector('.whois-user-CLKED1 .cell-emails');
          return emailCell?.textContent?.trim() || null;
        })(),
      };
    });

    await browser.close();
    return result;
  }

  async getDomainInfo(domain: string) {

    if (!this.whoisApiKey) {
      throw new Error('Chave da API WHOIS não definida. Verifique o arquivo .env');
    }

    const whoisResponse = await axios.get('https://www.whoisxmlapi.com/whoisserver/WhoisService', {
      params: {
        apiKey: this.whoisApiKey,
        domainName: domain,
        outputFormat: 'JSON',
      },
    });

    const whoisData = whoisResponse.data.WhoisRecord;
    const registrant = whoisData?.registrant;

    const registroDisponivel = !!(
      registrant?.organization ||
      registrant?.name ||
      registrant?.email
    );

    let nomeRegistradora = whoisData?.registrarName || null;
    if (!nomeRegistradora && domain.endsWith('.br')) {
      nomeRegistradora = 'Registro.br';
    }
    const contatoRegistradora = nomeRegistradora ? this.REGISTRAR_CONTACTS[nomeRegistradora] || null : null;

    const registroBase = {
      disponivel: registroDisponivel,
      mensagem: registroDisponivel
        ? null
        : 'Os dados do registrante estão protegidos por serviço de privacidade da registradora.',
      registrante: registrant?.organization || registrant?.name || null,
      emailContato: registrant?.email || null,
      telefoneContato: registrant?.telephone || null,
      endereco: {
        rua: registrant?.street1 || null,
        cidade: registrant?.city || null,
        estado: registrant?.state || null,
        pais: registrant?.country || null,
      },
      criadoEm: whoisData?.createdDate || null,
      expiraEm: whoisData?.expiresDate || null,
      atualizadoEm: whoisData?.updatedDate || null,
      nameServers: whoisData?.nameServers?.hostNames || null,
      auditAtualizadoEm: whoisData?.audit?.updatedDate || null,
    };

    let registroBrInfo = {};
    if (domain.endsWith('.br')) {
      try {
        registroBrInfo = await this.getRegistroBrInfoComPuppeteer(domain);
      } catch (error) {
        console.warn('Erro ao fazer scraping do registro.br com puppeteer:', error.message);
      }
    }

    const registro = {
      ...registroBase,
      ...(registroBrInfo && { registroBr: registroBrInfo }),
    };

    let ip = '';
    try {
      const addresses = await dns.resolve4(domain);
      ip = addresses[0];
    } catch (err) {
      console.error('Erro ao resolver IP', err);
    }

    let ipInfo = {};
    let arinInfo = {
      nome: null,
      org: null,
      contatos: [],
      enderecos: [],
    };

    if (ip) {
      const ipApi = await axios.get(`http://ip-api.com/json/${ip}`);
      ipInfo = ipApi.data;

      try {
        const rdapResponse = await axios.get(`https://rdap.arin.net/registry/ip/${ip}`);
        const entities = rdapResponse.data?.entities || [];

        const contatos = [];
        const enderecos = [];

        for (const entity of entities) {
          const vcard = entity.vcardArray?.[1] || [];
          for (const item of vcard) {
            if (item[0] === 'email' && item[3]) contatos.push(item[3]);
            if (item[0] === 'adr' && item[3]) enderecos.push(item[3]);
          }
        }

        arinInfo = {
          nome: rdapResponse.data?.name || null,
          org: rdapResponse.data?.org?.name || null,
          contatos,
          enderecos,
        };
      } catch (error) {
        console.warn('ARIN RDAP não disponível para esse IP ou falhou.');
      }
    }

    return {
      domain,
      ip,
      registro,
      registradora: nomeRegistradora
        ? {
          nome: nomeRegistradora,
          ...contatoRegistradora,
        }
        : null,
      hospedagem: {
        organizacao: ipInfo['org'] || null,
        asn: ipInfo['as'] || null,
        cidade: ipInfo['city'] || null,
        pais: ipInfo['country'] || null,
        isp: ipInfo['isp'] || null,
        timezone: ipInfo['timezone'] || null,
        hosting: ipInfo['hosting'] ?? null,
        arin: arinInfo,
      },
    };
  }
}