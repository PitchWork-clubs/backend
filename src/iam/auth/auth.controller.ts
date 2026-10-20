import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  LoginDto,
  RegisterUserPersonDto,
  RefreshTokenDto,
  ResendVerificationDto,
  VerifyIdentifierDto,
} from './auth.dto';
import { Request, Response } from 'express';
import { PassportJwtGuard } from '@common/guards/passport.guard';
import { CurrentUser } from '@common/decorators/current-user';
import { TPayload, TUserData } from './auth.types';
import { UserTokenService } from '../user-token/user-token.service';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  SendVerifyEmailDto,
  VerifyEmailDto,
} from '../user-token/user-token.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private userTokenService: UserTokenService,
  ) {}

  @HttpCode(HttpStatus.CREATED)
  @Post('/signup')
  public async register(@Body() registerDto: RegisterUserPersonDto) {
    const userData = await this.authService.registerUserPerson(registerDto);

    return {
      message:
        'If the identifier can be registered, verification instructions will be sent.',
      user: 'duplicate' in userData ? undefined : userData,
      ...(userData.verificationRequired && !('duplicate' in userData)
        ? {
            verification: {
              required: true,
              channel: userData.verificationChannel,
            },
          }
        : {}),
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('/login')
  public async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.validateCredentials(loginDto, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    if ('status' in result) return result;

    const isMobile = req.header('x-client-type')?.toLowerCase() === 'mobile';
    if (!isMobile) {
      res.cookie('accessToken', result.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 15 * 60_000,
      });
      res.cookie('refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/api/auth',
        maxAge: 30 * 24 * 60 * 60_000,
      });
    }

    return {
      message: 'Logged in Successfully',
      user: result.user,
      accessToken: isMobile ? result.accessToken : undefined,
      refreshToken: isMobile ? result.refreshToken : undefined,
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('/refresh')
  public async refresh(
    @Body() data: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = data.refreshToken ?? req.cookies?.refresh_token;
    const result = await this.authService.refreshSession(refreshToken);
    const isMobile = req.header('x-client-type')?.toLowerCase() === 'mobile';
    if (!isMobile) {
      res.cookie('accessToken', result.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 15 * 60_000,
      });
      res.cookie('refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/api/auth',
        maxAge: 30 * 24 * 60 * 60_000,
      });
    }
    return {
      accessToken: isMobile ? result.accessToken : undefined,
      refreshToken: isMobile ? result.refreshToken : undefined,
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('/logout')
  @UseGuards(PassportJwtGuard)
  public async logout(
    @CurrentUser() user: { user_id: string; sid?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.logout(user.user_id, user.sid);
    res.cookie('accessToken', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      expires: new Date(0), // Setting expiration date to Jan 1, 1970 (tells browser to delete it instantly)
    });
    res.cookie('refresh_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth',
      expires: new Date(0),
    });
    return result;
  }

  @HttpCode(HttpStatus.OK)
  @Post('/logout-all')
  @UseGuards(PassportJwtGuard)
  public async logoutAll(
    @CurrentUser() user: { user_id: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.logoutAll(user.user_id);
    res.cookie('accessToken', '', { expires: new Date(0) });
    res.cookie('refresh_token', '', {
      expires: new Date(0),
      path: '/api/auth',
    });
    return result;
  }

  @HttpCode(HttpStatus.OK)
  @Get('/sessions')
  @UseGuards(PassportJwtGuard)
  public async sessions(@CurrentUser() user: { user_id: string }) {
    return this.authService.listSessions(user.user_id);
  }

  @HttpCode(HttpStatus.OK)
  @Delete('/sessions/:id')
  @UseGuards(PassportJwtGuard)
  public async revokeSession(
    @CurrentUser() user: { user_id: string },
    @Param('id') sessionId: string,
  ) {
    return this.authService.revokeSession(user.user_id, sessionId);
  }

  @HttpCode(HttpStatus.OK)
  @Get('/me')
  @UseGuards(PassportJwtGuard)
  public async getMe(@CurrentUser() user: any) {
    const { user_id, person_id } = user;
    return await this.authService.getUserData(user_id, person_id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('verify')
  public async verifyIdentifier(@Body() data: VerifyIdentifierDto) {
    return await this.authService.verifyIdentifier(data);
  }

  @HttpCode(HttpStatus.OK)
  @Post('verify/resend')
  public async resendVerification(@Body() data: ResendVerificationDto) {
    return await this.authService.resendVerification(data);
  }

  @HttpCode(HttpStatus.OK)
  @Post('email/send-verify')
  public async sendVerifyEmail(@Body() data: SendVerifyEmailDto) {
    return await this.userTokenService.sendVerifyEmail(data.email);
  }

  @HttpCode(HttpStatus.OK)
  @Put('email/verify')
  public async verifyEMail(@Body() data: VerifyEmailDto) {
    return await this.authService.verifyIdentifier({ token: data.token });
  }

  /**
   * Magic-link target for email verification when no frontend is configured.
   *
   * The link embedded in the verification email points here (via APP_URL) when
   * FRONTEND_URL is absent. Once a frontend exists, it handles the link instead
   * and this endpoint is no longer reached via email.
   *
   * Usage: GET /auth/email/verify-link?email=user@example.com&token=AB12CD
   */
  @HttpCode(HttpStatus.OK)
  @Get('email/verify-link')
  public async verifyEmailViaLink(
    @Query('email') email: string,
    @Query('token') token: string,
  ) {
    return await this.authService.verifyIdentifier({
      token: token?.trim(),
    });
  }

  @Post('password/forgot')
  public async forgotPassword(@Body() data: ForgotPasswordDto) {
    return await this.userTokenService.forgotPassword(data.email);
  }

  @Put('password/reset')
  public async resetPassword(@Body() data: ResetPasswordDto) {
    return await this.userTokenService.resetPassword(data);
  }
}
