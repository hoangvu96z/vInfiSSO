import { CreateMemberAppDto } from './dto/create-member-app.dto';
export declare class MemberAppService {
    private readonly memberApps;
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
