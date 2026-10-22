import { Test, TestingModule } from '@nestjs/testing';
import { existsSync, readFileSync } from 'node:fs';
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
});
