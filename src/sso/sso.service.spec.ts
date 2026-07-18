import { Test, TestingModule } from '@nestjs/testing';
import { SsoService } from './sso.service';

describe('SsoService', () => {
  let service: SsoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: SsoService,
          useValue: {
            login: jest.fn(),
            resolveSession: jest.fn(),
            logout: jest.fn(),
            register: jest.fn(),
            oauthLogin: jest.fn(),
            sanitizeUser: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SsoService>(SsoService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
