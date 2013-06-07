/**
 * jsSMS - A Sega Master System/Game Gear emulator in JavaScript
 * Copyright (C) 2012  Guillaume Marty (https://github.com/gmarty)
 * Based on JavaGear Copyright (c) 2002-2008 Chris White
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

'use strict';

/** @const */ var UINT8 = 1;
/** @const */ var INT8 = 2;
/** @const */ var UINT16 = 3;


// List of high level node types. Think of it as basic blocks of AST.
/** @struct */
var n = {
  IfStatement: function(test, consequent, alternate) {
    if (alternate == undefined) alternate = null;
    return {
      'type': 'IfStatement',
      'test': test,
      'consequent': consequent,
      'alternate': alternate
    };
  },
  BlockStatement: function(body) {
    if (body == undefined) body = [];
    return {
      'type': 'BlockStatement',
      'body': body
    };
  },
  ExpressionStatement: function(expression) {
    return {
      'type': 'ExpressionStatement',
      'expression': expression
    };
  },
  // This is not a real AST block, but it's convenient for manipulating registers in optimizer.
  Register: function(name) {
    return {
      'type': 'Register',
      'name': name
    };
  },
  Identifier: function(name) {
    return {
      'type': 'Identifier',
      'name': name
    };
  },
  Literal: function(value) {
    return {
      'type': 'Literal',
      'value': value
    };
  },
  CallExpression: function(callee, args) {
    if (args == undefined) args = [];
    if (!Array.isArray(args)) args = [args];
    return {
      'type': 'CallExpression',
      'callee': n.Identifier(callee),
      'arguments': args
    };
  },
  AssignmentExpression: function(operator, left, right) {
    return {
      'type': 'AssignmentExpression',
      'operator': operator,
      'left': left,
      'right': right
    };
  },
  BinaryExpression: function(operator, left, right) {
    return {
      'type': 'BinaryExpression',
      'operator': operator,
      'left': left,
      'right': right
    };
  },
  MemberExpression: function(object, property) {
    return {
      'type': 'MemberExpression',
      'computed': true, // Generate `object[property]`.
      'object': object,
      'property': property
    };
  },
  ReturnStatement: function(argument) {
    if (argument == undefined) argument = null;
    return {
      'type': 'ReturnStatement',
      'argument': argument
    };
  }
};


// List of common operations for the Z80.
// Each entry returns a function accepting an optional parameter.
/** @struct */
var o = {
  NOOP: function() {
    return function() {
      return;
    }
  },
  LD8: function(srcRegister, dstRegister1, dstRegister2) {
    if (dstRegister1 == undefined && dstRegister2 == undefined)
      // Direct value assignment (ex: `LD B,n`).
      return function(value) {
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register(srcRegister), n.Literal(value))
        );
      };
    if (dstRegister2 == undefined)
      // Register assignment (ex: `LD B,C`).
      return function() {
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register(srcRegister), n.Register(dstRegister1))
        );
      };
    if (dstRegister1 == 'n' && dstRegister2 == 'n')
      // Direct address value assignment (ex: `LD A,(nn)`).
      return function(value) {
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register(srcRegister), o.READ_MEM8(n.Literal(value)))
        );
      };
    else
      // Register address value assignment (ex: `LD A,(BC)`).
      return function() {
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register(srcRegister),
            o.READ_MEM8(n.CallExpression('get' + (dstRegister1 + dstRegister2).toUpperCase()))
            )
        );
      };
  },
  LD16: function(srcRegister1, srcRegister2, dstRegister1, dstRegister2) {
    if (dstRegister1 == undefined && dstRegister2 == undefined)
      // Direct value assignment (ex: `LD HL,nn`).
      return function(value) {
        return n.ExpressionStatement(
            n.CallExpression('set' + (srcRegister1 + srcRegister2).toUpperCase(), n.Literal(value))
        );
      };
    if (dstRegister1 == 'n' && dstRegister2 == 'n')
      // Direct address value assignment (ex: `LD HL,(nn)`).
      return function(value) {
        return n.ExpressionStatement(
            n.CallExpression('set' + (srcRegister1 + srcRegister2).toUpperCase(), o.READ_MEM16(n.Literal(value)))
        );
      };
    else
      throw Error('Wrong parameters number');
  },
  LD_WRITE_MEM: function(srcRegister1, srcRegister2, dstRegister1, dstRegister2) {
    if (dstRegister1 == undefined && dstRegister2 == undefined)
      // Direct value assignment (ex: `LD (HL),n`).
      return function(value) {
        return n.ExpressionStatement(
            n.CallExpression('writeMem', [n.CallExpression('get' + (srcRegister1 + srcRegister2).toUpperCase()), n.Literal(value)])
        );
      };
    if (srcRegister1 == 'n' && srcRegister2 == 'n' && dstRegister2 == undefined)
      // Direct address assignment (ex: `LD (nn),A`).
      return function(value) {
        return n.ExpressionStatement(
            n.CallExpression('writeMem', [n.Literal(value), n.Register(dstRegister1)])
        );
      };
    if (srcRegister1 == 'n' && srcRegister2 == 'n')
      // Direct address assignment (ex: `LD (nn),HL`).
      return function(value) {
        return [
          n.ExpressionStatement(
              n.CallExpression('writeMem', [n.Literal(value), n.Register(dstRegister2)])
          ),
          n.ExpressionStatement(
              n.CallExpression('writeMem', [n.Literal(value + 1), n.Register(dstRegister1)])
          )
        ];
      };
    else
      // Register assignment (ex: `LD (BC),a`).
      return function() {
        return n.ExpressionStatement(
            n.CallExpression('writeMem', [n.CallExpression('get' + (srcRegister1 + srcRegister2).toUpperCase()), n.Register(dstRegister1)])
        );
      };
  },
  LD_SP: function() {
    return function(value) {
      return n.ExpressionStatement(
          n.AssignmentExpression('=', n.Identifier('sp'), n.Literal(value))
      );
    };
  },
  INC8: function(register) {
    return function() {
      return n.ExpressionStatement(
          n.AssignmentExpression('=', n.Register(register), n.CallExpression('inc8', n.Register(register)))
      );
    };
  },
  INC16: function(register1, register2) {
    return function() {
      return n.ExpressionStatement(
          n.CallExpression('inc' + (register1 + register2).toUpperCase())
      );
    };
  },
  DEC8: function(register) {
    return function() {
      return n.ExpressionStatement(
          n.AssignmentExpression('=', n.Register(register), n.CallExpression('dec8', n.Register(register)))
      );
    };
  },
  DEC16: function(register1, register2) {
    return function() {
      return n.ExpressionStatement(
          n.CallExpression('dec' + (register1 + register2).toUpperCase())
      );
    };
  },
  ADD16: function(register1, register2, register3, register4) {
    return function() {
      // setHL(add16(getHL(), getBC()));
      return n.ExpressionStatement(
          n.CallExpression('set' + (register1 + register2).toUpperCase(),
          n.CallExpression('add16',
          [n.CallExpression('get' + (register1 + register2).toUpperCase()),
           n.CallExpression('get' + (register3 + register4).toUpperCase())]
          )
          )
      );
    };
  },
  EX_AF: function() {
    return function() {
      return n.ExpressionStatement(
          n.CallExpression('exAF')
      );
    };
  },
  RLA: function() {
    return function() {
      return n.ExpressionStatement(
          n.CallExpression('rla_a')
      );
    };
  },
  RRA: function() {
    return function() {
      return n.ExpressionStatement(
          n.CallExpression('rra_a')
      );
    };
  },
  ADD: function(register1, register2) {
    if (register1 == undefined && register2 == undefined)
      return function(value) {
        // add_a(value);
        return n.ExpressionStatement(
            n.CallExpression('add_a', n.Literal(value))
        );
      };
    if (register2 == undefined)
      return function() {
        // add_a(b);
        return n.ExpressionStatement(
            n.CallExpression('add_a', n.Register(register1))
        );
      };
    else
      return function() {
        // add_a(readMem(getHL()));
        return n.ExpressionStatement(
            n.CallExpression('add_a', o.READ_MEM8(n.CallExpression('get' + (register1 + register2).toUpperCase())))
        );
      };
  },
  SUB: function(register1, register2) {
    if (register1 == undefined && register2 == undefined)
      // sub_a(value);
      return function(value, target, currentAddress) {
        return n.ExpressionStatement(
            n.CallExpression('sub_a', n.Literal(value))
        );
      };
    if (register2 == undefined)
      return function() {
        // sub_a(b);
        return n.ExpressionStatement(
            n.CallExpression('sub_a', n.Register(register1))
        );
      };
    else
      return function() {
        // sub_a(readMem(getHL()));
        return n.ExpressionStatement(
            n.CallExpression('sub_a', o.READ_MEM8(n.CallExpression('get' + (register1 + register2).toUpperCase())))
        );
      };
  },
  AND: function(register1, register2) {
    if (register1 == undefined && register2 == undefined)
      return function(value, target, currentAddress) {
        // a &= value; f = SZP_TABLE[a] | F_HALFCARRY;
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('&=', n.Register('a'), n.Literal(value))
          ),
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('f'),
              n.BinaryExpression('|',
                n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a')),
                n.Literal(F_HALFCARRY)
              )
              )
          )
        ];
      };
    if (register1 != 'a' && register2 == undefined)
      return function() {
        // a &= b; f = SZP_TABLE[a] | F_HALFCARRY;
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('&=', n.Register('a'), n.Register(register1))
          ),
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('f'),
              n.BinaryExpression('|',
                n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a')),
                n.Literal(F_HALFCARRY)
              )
              )
          )
        ];
      };
    if (register1 == 'a' && register2 == undefined)
      return function() {
        // f = SZP_TABLE[a] | F_HALFCARRY;
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register('f'),
            n.BinaryExpression('|',
            n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a')),
            n.Literal(F_HALFCARRY)
            )
            )
        );
      };
    else
      return [
        // a &= readMem(getHL()); f = SZP_TABLE[a] | F_HALFCARRY;
        n.ExpressionStatement(
            n.AssignmentExpression('&=', n.Register('a'), o.READ_MEM8(n.CallExpression('get' + (register1 + register2).toUpperCase())))
        ),
        n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register('f'),
            n.BinaryExpression('|',
              n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a')),
              n.Literal(F_HALFCARRY)
            )
            )
        )
      ];
  },
  XOR: function(register1, register2) {
    if (register1 == undefined && register2 == undefined)
      return function(value, target, currentAddress) {
        // a ^= value; f = SZP_TABLE[a];
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('^=', n.Register('a'), n.Literal(value))
          ),
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('f'),
              n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a'))
              )
          )
        ];
      };
    if (register1 != 'a' && register2 == undefined)
      return function() {
        // a ^= b; f = SZP_TABLE[a];
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('^=', n.Register('a'), n.Register(register1))
          ),
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('f'),
              n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a'))
              )
          )
        ];
      };
    if (register1 == 'a' && register2 == undefined)
      return function() {
        // a = 0; f = SZP_TABLE[0];
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('a'), n.Literal(0))
          ),
          n.ExpressionStatement(
              // @todo Find a better way of calling `SZP_TABLE` than `sms.cpu.SZP_TABLE`.
              //n.AssignmentExpression('=', n.Register('f'), n.Literal(sms.cpu.SZP_TABLE[0]))
              n.AssignmentExpression('=', n.Register('f'), n.MemberExpression(n.Identifier('SZP_TABLE'), n.Literal(0)))
          )
        ];
      };
    else
      return function() {
        // a ^= readMem(getHL()); f = SZP_TABLE[a];
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('^=', n.Register('a'), o.READ_MEM8(n.CallExpression('get' + (register1 + register2).toUpperCase())))
          ),
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('f'),
              n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a'))
              )
          )
        ];
      };
  },
  OR: function(register1, register2) {
    if (register1 == undefined && register2 == undefined)
      return function(value, target, currentAddress) {
        // a |= value; f = SZP_TABLE[a];
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('|=', n.Register('a'), n.Literal(value))
          ),
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('f'),
              n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a'))
              )
          )
        ];
      };
    if (register1 != 'a' && register2 == undefined)
      return function() {
        // a |= b; f = SZP_TABLE[a];
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('|=', n.Register('a'), n.Register(register1))
          ),
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('f'),
              n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a'))
              )
          )
        ];
      };
    if (register1 == 'a' && register2 == undefined)
      return function() {
        // f = SZP_TABLE[a];
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register('f'),
            n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a'))
            )
        );
      };
    else
      return function() {
        // a |= readMem(getHL()); f = SZP_TABLE[a];
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('|=', n.Register('a'), o.READ_MEM8(n.CallExpression('get' + (register1 + register2).toUpperCase())))
          ),
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('f'),
              n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a'))
              )
          )
        ];
      };
  },
  CP: function(register1, register2) {
    if (register1 == undefined && register2 == undefined)
      return function(value) {
        // cp_a(value);
        return n.ExpressionStatement(
            n.CallExpression('cp_a', n.Literal(value))
        );
      };
    if (register2 == undefined)
      return function() {
        // cp_a(b);
        return n.ExpressionStatement(
            n.CallExpression('cp_a', n.Register(register1))
        );
      };
    else
      return function() {
        // cp_a(readMem(getHL()));
        return n.ExpressionStatement(
            n.CallExpression('cp_a', o.READ_MEM8(n.CallExpression('get' + (register1 + register2).toUpperCase())))
        );
      };
  },
  POP: function(register1, register2) {
    return function() {
      // setBC(readMemWord(sp));
      return n.ExpressionStatement(
          n.CallExpression('set' + (register1 + register2).toUpperCase(), o.READ_MEM16(n.Literal('sp')))
      );
    };
  },
  PUSH: function(register1, register2) {
    return function() {
      // push2(b, c);
      return n.ExpressionStatement(
          n.CallExpression('push2', [n.Register(register1), n.Register(register2)])
      );
    };
  },
  JR: function(test) {
    return function(value, target) {
      // if (test) {pc = target; tstates -= 5;}
      return n.IfStatement(
          test,
          n.BlockStatement([
            n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), n.Literal(target))),
            n.ExpressionStatement(n.AssignmentExpression('-=', n.Identifier('tstates'), n.Literal(5)))
          ])
      );
    };
  },
  DJNZ: function() {
    return function(value, target) {
      // b = (b - 1) & 0xFF; if (b != 0) {pc = target; tstates -= 5;}
      return [
        n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register('b'), n.BinaryExpression('&', n.BinaryExpression('-', n.Register('b'), n.Literal(1)), n.Literal(0xFF)))
        ),
        o.JR(n.BinaryExpression('!=', n.Register('b'), n.Literal(0)))(undefined, target)
      ];
    };
  },
  RET: function(operator, bitMask) {
    if (operator == undefined && bitMask == undefined)
      return function() {
        // pc = readMemWord(sp); sp += 2; return;
        return [
          n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), o.READ_MEM16(n.Identifier('sp')))),
          n.ExpressionStatement(n.AssignmentExpression('+=', n.Identifier('sp'), n.Literal(2))),
          n.ReturnStatement()
        ];
      };
    else
      return function() {
        // ret((f & F_ZERO) == 0);
        return n.ExpressionStatement(
            n.CallExpression('ret', n.BinaryExpression(operator,
            n.BinaryExpression('&', n.Register('f'), n.Literal(bitMask)),
            n.Literal(0)
            ))
        );
      };
  },
  JP: function(operator, bitMask) {
    if (operator == undefined && bitMask == undefined)
      return function(value, target, currentAddress) {
        // pc = readMemWord(target); return;
        return [
          n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), n.Literal(target))),
          n.ReturnStatement()
        ];
      };
    else
      return function(value, target) {
        // if ((f & F_SIGN) != 0) {pc = target; return;}
        return n.IfStatement(
            n.BinaryExpression(operator,
            n.BinaryExpression('&', n.Register('f'), n.Literal(bitMask)),
            n.Literal(0)
            ),
            n.BlockStatement([
              n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), n.Literal(target))),
              n.ReturnStatement()
            ])
        );
      };
  },
  CALL: function(operator, bitMask) {
    if (operator == undefined && bitMask == undefined)
      return function(value, target, currentAddress) {
        // push1(currentAddress + 2); pc = target; return;
        return [
          n.ExpressionStatement(n.CallExpression('push1', n.Literal(currentAddress + 2))),
          n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), n.Literal(target))),
          n.ReturnStatement()
        ];
      };
    else
      return function(value, target, currentAddress) {
        // if ((f & F_ZERO) == 0) {push1(currentAddress + 2); pc = target; tstates -= 7; return;}
        return n.IfStatement(
            n.BinaryExpression(operator,
            n.BinaryExpression('&', n.Register('f'), n.Literal(bitMask)),
            n.Literal(0)
            ),
            n.BlockStatement([
              n.ExpressionStatement(n.CallExpression('push1', n.Literal(currentAddress + 2))),
              n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), n.Literal(target))),
              n.ExpressionStatement(n.AssignmentExpression('-=', n.Identifier('tstates'), n.Literal(7))),
              n.ReturnStatement()
            ])
        );
      };
  },
  RST: function(targetAddress) {
    return function(value, target, currentAddress) {
      // push1(currentAddress); pc = target; return;
      return [
        n.ExpressionStatement(n.CallExpression('push1', n.Literal(currentAddress))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), n.Literal(targetAddress))),
        n.ReturnStatement()
      ];
    };
  },
  DI: function() {
    return function() {
      // iff1 = false; iff2 = false; EI_inst = true;
      return [
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('iff1'), n.Literal(false))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('iff2'), n.Literal(false))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('EI_inst'), n.Literal(true)))
      ];
    };
  },
  // @todo Apply peephole optimizations when port address is known.
  OUT: function(register1, register2) {
    if (register2 == undefined)
      return function(value, target, currentAddress) {
        // port.out(value, a);
        return n.ExpressionStatement(
            n.CallExpression('port.out', [n.Literal(value), n.Register(register1)])
        );
      };
  },
  IN: function(register1, register2) {
    if (register2 == undefined)
      return function(value, target, currentAddress) {
        // a = this.port.in_(value);
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register(register1), n.CallExpression('port.in_', n.Literal(value)))
        );
      };
  },
  IM1: function() {
    return function() {
      // im = 1;
      return n.ExpressionStatement(
          n.AssignmentExpression('=', n.Identifier('im'), n.Literal(1))
      );
    };
  },
  // Below these point, properties can't be called from outside object `n`.
  // Move to object `o`? Mark as private?
  READ_MEM8: function(value) {
    return n.CallExpression('readMem', value);
  },
  READ_MEM16: function(value) {
    return n.CallExpression('readMemWord', value);
  }
};