import { Test, TestingModule } from '@nestjs/testing';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Response } from 'express';
import { AppController } from './app.controller';
import { AppService } from './app.service';

jest.mock('node:fs', () => {
  const actual = jest.requireActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
  };
});

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    (existsSync as jest.Mock).mockReset();
    (readFileSync as jest.Mock).mockReset();

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('should be defined', () => {
    expect(appController).toBeDefined();
  });

  it('does not serve the removed legacy admin page if the React build is missing', () => {
    (existsSync as jest.Mock).mockReturnValue(false);
    const responseMock = {
      status: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };

    appController.getReactApp(responseMock as unknown as Response);

    expect(responseMock.status).toHaveBeenCalledWith(503);
    expect(responseMock.type).toHaveBeenCalledWith('text/plain');
    expect(responseMock.send).toHaveBeenCalledWith('Web UI is not built');
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('serves the React entry point from the deployed application root', () => {
    const reactIndex = join(process.cwd(), 'admin-ui', 'dist', 'index.html');
    (existsSync as jest.Mock).mockReturnValue(true);
    (readFileSync as jest.Mock).mockReturnValue('<html>SSO</html>');
    const responseMock = {
      setHeader: jest.fn(),
      send: jest.fn(),
    };

    appController.getReactApp(responseMock as unknown as Response);

    expect(existsSync).toHaveBeenCalledWith(reactIndex);
    expect(readFileSync).toHaveBeenCalledWith(reactIndex, 'utf8');
    expect(responseMock.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/html; charset=utf-8',
    );
    expect(responseMock.send).toHaveBeenCalledWith('<html>SSO</html>');
  });

  it('serves React assets from the deployed application root', () => {
    const assetPath = join(
      process.cwd(),
      'admin-ui',
      'dist',
      'assets',
      'app.js',
    );
    (existsSync as jest.Mock).mockReturnValue(true);
    const responseMock = {
      setHeader: jest.fn(),
      sendFile: jest.fn(),
    };

    appController.getReactAsset('app.js', responseMock as unknown as Response);

    expect(existsSync).toHaveBeenCalledWith(assetPath);
    expect(responseMock.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/javascript',
    );
    expect(responseMock.sendFile).toHaveBeenCalledWith(assetPath);
  });

  it('serves legacy HTML pages from Nest’s deployed asset directory', () => {
    const pagePath = join(process.cwd(), 'dist', 'sso', 'app-a-page.html');
    (readFileSync as jest.Mock).mockReturnValue('<html>App A</html>');
    const responseMock = {
      setHeader: jest.fn(),
      send: jest.fn(),
    };

    appController.getAppAPage(responseMock as unknown as Response);

    expect(readFileSync).toHaveBeenCalledWith(pagePath, 'utf8');
    expect(responseMock.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/html; charset=utf-8',
    );
    expect(responseMock.send).toHaveBeenCalledWith('<html>App A</html>');
  });

  it('serves the favicon from Nest’s deployed asset directory', () => {
    const faviconPath = join(
      process.cwd(),
      'dist',
      'sso',
      'vlnfi_sso_favicon_option_1.svg',
    );
    (readFileSync as jest.Mock).mockReturnValue('<svg></svg>');
    const responseMock = {
      setHeader: jest.fn(),
      send: jest.fn(),
    };

    appController.getFavicon(responseMock as unknown as Response);

    expect(readFileSync).toHaveBeenCalledWith(faviconPath, 'utf8');
    expect(responseMock.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'image/svg+xml',
    );
    expect(responseMock.send).toHaveBeenCalledWith('<svg></svg>');
  });
});
