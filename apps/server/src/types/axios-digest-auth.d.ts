// @mhoc/axios-digest-auth ships no types of its own — minimal ambient
// declaration covering the surface this project actually uses.
declare module '@mhoc/axios-digest-auth' {
  import type { AxiosRequestConfig, AxiosResponse } from 'axios';

  export interface DigestAuthOptions {
    username: string;
    password: string;
  }

  export default class AxiosDigestAuth {
    constructor(options: DigestAuthOptions);
    request<T = any>(config: AxiosRequestConfig): Promise<AxiosResponse<T>>;
  }
}
