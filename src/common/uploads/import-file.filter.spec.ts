import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { importFileFilter } from './import-file.filter';

describe('importFileFilter', () => {
  const request = {} as Request;

  it('rechaza archivos XLS heredados que los parsers no soportan', () => {
    const callback = jest.fn();

    importFileFilter(
      request,
      {
        originalname: 'escuelas.xls',
        mimetype: 'application/vnd.ms-excel',
      } as Express.Multer.File,
      callback,
    );

    expect(callback).toHaveBeenCalledWith(
      expect.any(BadRequestException),
      false,
    );
  });

  it('conserva el MIME de Excel para archivos CSV compatibles', () => {
    const callback = jest.fn();

    importFileFilter(
      request,
      {
        originalname: 'escuelas.csv',
        mimetype: 'application/vnd.ms-excel',
      } as Express.Multer.File,
      callback,
    );

    expect(callback).toHaveBeenCalledWith(null, true);
  });
});
