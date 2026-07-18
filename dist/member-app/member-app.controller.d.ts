import { MemberAppService } from './member-app.service';
import { CreateMemberAppDto } from './dto/create-member-app.dto';
export declare class MemberAppController {
    private readonly memberAppService;
    constructor(memberAppService: MemberAppService);
    createMember(dto: CreateMemberAppDto): {
        success: boolean;
        memberApp: {
            id: string;
            appName: string;
            appId: string | null;
            memberName: string;
            email: string;
            role: string;
            status: string;
            createdAt: string;
        };
    };
    listMembers(): {
        memberApps: {
            id: string;
            appName: string;
            appId?: string | null;
            memberName: string;
            email: string;
            role: string;
            status: string;
            createdAt: string;
        }[];
    };
}
